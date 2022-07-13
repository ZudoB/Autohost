class RESTError extends Error {

    constructor(message, status) {
        super(message);

        this.statusCode = status || 500;
    }

    getStatusCode() {
        return this.statusCode;
    }

    getUserFacingMessage() {
        return this.message;
    }
}

module.exports = RESTError;
