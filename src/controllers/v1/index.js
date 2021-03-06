const {StatusCodes} = require("http-status-codes");
const {Router} = require('express');

const routes = [
    require('./automate'),
    require('./machine'),
    require('./weather'),
];

module.exports = (ctx, app) => {
    const router = Router();
    router.get('/', (_, res) => {
        res.send({status: StatusCodes.OK});
    });
    routes.forEach((c) => c(ctx, router));
    app.use('/v1', router);
};
