'use strict';

const moment = require('moment');
const _ = require('underscore');

const DATE_PARTS = ['day', 'month', 'year'];

module.exports = Controller => class extends Controller {
    configure(req, res, next) {
        req.form.options.dateFields = _.keys(_.pick(
            req.form.options.fields,
            field => field.validate === 'date' || _.contains(field.validate, 'date'))
        );

        _.forEach(req.form.options.dateFields, fieldName => this.configureDateField(req, fieldName));

        super.configure(req, res, next);
    }

    configureDateField(req, fieldName) {
        let dateField = req.form.options.fields[fieldName];
        let required = _.contains(dateField.validate, 'required');

        DATE_PARTS.forEach(part => {
            // get any existing date part field options
            let field = req.form.options.fields[fieldName + '-' + part];

            field = _.extend({
                errorGroup: fieldName,
                hintId: fieldName + '-hint',
                contentKey: 'date-' + part,
                autocomplete: dateField.autocomplete &&
                    (dateField.autocomplete === 'off' ? 'off' : (dateField.autocomplete +'-' + part)),
                dependent: dateField.dependent,
                labelClassName: 'form-label'
            }, field);

            // add date part validators first
            if (!field.validate) field.validate = [];
            if (!_.isArray(field.validate)) field.validate = [ field.validate ];

            field.validate.unshift('date-' + part);
            field.validate.unshift('numeric');

            // only make part required if date field is required
            if (required) field.validate.unshift('required');

            req.form.options.fields[fieldName + '-' + part] = field;
        });
    }

    getValues(req, res, callback) {
        super.getValues(req, res, (err, values) => {
            if (err) return callback(err);
            let errorValues = req.sessionModel.get('errorValues') || {};
            req.form.options.dateFields.forEach(fieldName => {
                if (!values[fieldName]) return;
                let [year, month, day] = values[fieldName].split('-');
                values[fieldName + '-day'] = errorValues[fieldName + '-day-raw'] || day;
                values[fieldName + '-month'] = errorValues[fieldName + '-month-raw'] || month;
                values[fieldName + '-year'] = errorValues[fieldName + '-year-raw'] || year;
            });
            callback(null, values);
        });
    }

    process(req, res, next) {
        _.forEach(req.form.options.dateFields, fieldName => this.processDateField(req, fieldName));
        super.process(req, res, next);
    }

    processDateField(req, fieldName) {
        const dayName = fieldName + '-day';
        const monthName = fieldName + '-month';
        const yearName = fieldName + '-year';

        let body = req.form.values;
        let field = req.form.options.fields[fieldName];

        // save raw values to replay on validation error
        body[dayName + '-raw'] = body[dayName];
        body[monthName + '-raw'] = body[monthName];
        body[yearName + '-raw'] = body[yearName];

        body[dayName] = this.isExactDate(field) ? this._padDayMonth(body[dayName]) : '01';
        body[monthName] = this._padDayMonth(body[monthName]);
        body[yearName] = this._padYear(body[yearName], field.offset);

        body[fieldName] = body[yearName] + '-' + body[monthName] + '-' + body[dayName];

        if (body[fieldName] === '--' || (!this.isExactDate(field) && body[fieldName] === '--01')) {
            body[fieldName] = '';
        }
    }

    isExactDate(field) {
        return !field.inexact;
    }

    getDateParts(field) {
        return this.isExactDate(field) ? DATE_PARTS : DATE_PARTS.slice(1);
    }

    _padDayMonth(value) {
        if (value && value.match(/^\d$/)) return '0' + value;
        return value;
    }

    _padYear(value, offset) {
        if (value && value.match(/^\d{2}$/)) {
            let year = parseInt(value, 10);
            let centurySplit = (moment().year() - 2000) + (offset || 0);
            let prefix = (year <= centurySplit) ? '20' : '19';
            return prefix + value;
        }
        return value;
    }

    validateFields(req, res, callback) {
        super.validateFields(req, res, errors => {
            _.forEach(req.form.options.dateFields, fieldName => this.validateDateField(req, fieldName, errors));
            callback(errors);
        });
    }

    validateDateField(req, fieldName, errors) {
        let field = req.form.options.fields[fieldName];
        let fieldErrors = _.pick(errors, (error, key) => key !== fieldName && error.errorGroup === fieldName);

        let requiredErrors = _.pick(fieldErrors, error => error.type === 'required');
        if (!_.isEmpty(requiredErrors)) {
            let dateParts = this.getDateParts(field);
            let fieldCount = dateParts.length;
            let errorType = 'required';
            let part;
            if (Object.keys(requiredErrors).length < fieldCount) {
                part = _.find(dateParts, part => requiredErrors[fieldName + '-' + part]);
                /* istanbul ignore next */
                if (part) errorType += '-' + part;
            }
            errors[fieldName] = new this.Error(
                fieldName,
                {
                    type: errorType,
                    field: fieldName + '-' + (part || 'day'),
                    errorGroup: fieldName
                },
                req
            );
            if (part) {
                _.each(dateParts, datePart => {
                    let error = errors[fieldName + '-' + datePart];
                    if (error && error.type === 'required') error.type = 'required-' + datePart;
                });
            }
            return;
        }

        if (!req.form.values[fieldName]) return;

        let numericErrors = _.pick(fieldErrors, error => error.type === 'numeric');
        if (!_.isEmpty(numericErrors)) {
            let dateParts = this.getDateParts(field);
            let invalidParts = _.filter(dateParts, part => numericErrors[fieldName + '-' + part]);
            let part = invalidParts[0];

            if (!this.isExactDate(field) && invalidParts.length === dateParts.length) {
                _.each(invalidParts, datePart => delete errors[fieldName + '-' + datePart]);
            } else {
                _.each(invalidParts, datePart => {
                    errors[fieldName + '-' + datePart].type = 'numeric-' + datePart;
                });
            }
            errors[fieldName] = new this.Error(
                fieldName,
                {
                    type: !this.isExactDate(field) && invalidParts.length === dateParts.length ? 'numeric' : 'numeric-' + part,
                    field: fieldName + '-' + part,
                    errorGroup: fieldName
                },
                req
            );
            return;
        }

        let dateParts = this.getDateParts(field);
        let invalidDateParts = _.filter(dateParts, part =>
            fieldErrors[fieldName + '-' + part] && fieldErrors[fieldName + '-' + part].type === 'date-' + part
        );
        if (!_.isEmpty(invalidDateParts)) {
            let part = invalidDateParts[0];
            errors[fieldName] = new this.Error(
                fieldName,
                {
                    type: 'date-' + part,
                    field: fieldName + '-' + part,
                    errorGroup: fieldName
                },
                req
            );
            return;
        }

        if (req.form.values[fieldName].match(/^\d{4}-\d{2}-\d{2}$/)) {
            let code = moment(req.form.values[fieldName], 'YYYY-MM-DD').invalidAt();
            let invalidElement = null;
            /* istanbul ignore next */
            if (code === 0) invalidElement = 'year';
            if (code === 1) invalidElement = 'month';
            if (code === 2) invalidElement = 'day';

            if (invalidElement) {
                errors[fieldName] = errors[fieldName + '-' + invalidElement] = new this.Error(
                    fieldName + '-' + invalidElement,
                    {
                        type: 'date-' + invalidElement,
                        field: fieldName + '-' + invalidElement,
                        errorGroup: fieldName
                    },
                    req);
            }
        }

        if (errors[fieldName]) {
            if (!errors[fieldName].field) {
                errors[fieldName].field = fieldName + '-' + this.getDateParts(field)[0];
            } else if (!this.isExactDate(field) && errors[fieldName].field === fieldName + '-day') {
                errors[fieldName].field = fieldName + '-' + (errors[fieldName].type === 'date-year' ? 'year' : 'month');
            }
        }
    }

    saveValues(req, res, next) {
        _.forEach(req.form.options.dateFields, fieldName => {
            DATE_PARTS.forEach(part => {
                delete req.form.values[fieldName + '-' + part];
                delete req.form.values[fieldName + '-' + part + '-raw'];
            });
        });
        super.saveValues(req, res, next);
    }
};
