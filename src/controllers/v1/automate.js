const {StatusCodes} = require("http-status-codes");
const {Router} = require("express");
const {randomInt} = require('crypto');

const access = require("../../middlewares/access");
const AutomateItemSchema = require("../../schemas/AutomateItem");

const validator = require("express-validator");
const inspector = require("../../middlewares/inspector");

const sensitive_eraser = (j) => {
    if (j.assign_code) {
        j.assign_code = null;
    }
    return j;
};

module.exports = (ctx, r) => {
    const router = Router();
    const polling = require("express-longpoll")(router);

    const device_middleware_param = async (req, res, next) => {
        const commander_id = req.authenticated.sub;
        const AutomateItem = ctx.database.model("AutomateItem", AutomateItemSchema);
        const automate_item = await AutomateItem.findOne({
            _id: req.params.id,
            "commander._id": commander_id
        }).exec();
        if (!automate_item) {
            res.sendStatus(StatusCodes.NOT_FOUND);
            return;
        }
        req.device = automate_item;
        next();
    };

    const device_middleware_auth = async (req, res, next) => {
        const device_id = req.authenticated.sub;
        const AutomateItem = ctx.database.model("AutomateItem", AutomateItemSchema);
        const automate_item = await AutomateItem.findById(device_id).exec();
        if (!automate_item) {
            res.status(StatusCodes.NOT_FOUND).send("Unregistered Device");
            return;
        }
        req.device = automate_item;
        next();
    };

    // Register/Update Item
    router.put('/item',
        access,
        validator.body('features').isArray(),
        inspector,
        (req, res) => {
            const device_id = req.authenticated.sub;
            const assign_code = randomInt(1000000000, 9999999999);
            const AutomateItem = ctx.database.model("AutomateItem", AutomateItemSchema);
            AutomateItem.findOneAndUpdate({_id: device_id}, {
                features: req.body.features,
                assign_code
            }, {upsert: true})
                .then(() => res.status(StatusCodes.CREATED).send({
                    machine_id: device_id,
                    assign_code: assign_code,
                    updated_features: req.body.features,
                }))
                .catch((e) => {
                    res.sendStatus(StatusCodes.INTERNAL_SERVER_ERROR);
                    console.error(e);
                });
        }
    );

    // Manage device (for Commander)

    router.get("/devices", access, (req, res) => {
        const commander_id = req.authenticated.sub;
        const AutomateItem = ctx.database.model("AutomateItem", AutomateItemSchema);
        AutomateItem.find({"commander._id": commander_id})
            .then((i) => res.send(i.map(sensitive_eraser)))
            .catch((e) => {
                res.sendStatus(StatusCodes.INTERNAL_SERVER_ERROR);
                console.error(e);
            });
    });

    router.post("/device",
        access,
        validator.body('machine_id').isString(),
        validator.body('assign_code').isNumeric(),
        inspector,
        async (req, res) => {
            const commander_id = req.authenticated.sub;
            const AutomateItem = ctx.database.model("AutomateItem", AutomateItemSchema);
            const automate_item = await AutomateItem.findById(req.body.machine_id).exec();
            if (!automate_item) {
                res.sendStatus(StatusCodes.NOT_FOUND);
                return;
            }
            if (automate_item.assign_code !== req.body.assign_code) {
                res.sendStatus(StatusCodes.FORBIDDEN);
                return;
            }
            automate_item.commander = {
                _id: commander_id,
                assign_at: ctx.now(),
            };
            automate_item.assign_code = null;
            automate_item.save()
                .then(() => res.sendStatus(StatusCodes.NO_CONTENT))
                .catch((e) => {
                    res.sendStatus(StatusCodes.INTERNAL_SERVER_ERROR);
                    console.error(e);
                });
        }
    );

    router.get("/device/:id", access, device_middleware_param, (req, res) => {
        res.send(sensitive_eraser(req.device));
    });

    router.put("/device/:id", access, device_middleware_param, (req, res) => {
        req.device.state = req.device.state || {};
        req.device.state.direction = true;
        req.device.state.message = req.body.message;
        req.device.state.update_at = ctx.now();
        req.device.save()
            .then(() => {
                res.sendStatus(StatusCodes.NO_CONTENT);
                polling.publishToId("/state/poll", req.device._id, req.device.state);
            })
            .catch((e) => {
                res.sendStatus(StatusCodes.INTERNAL_SERVER_ERROR);
                console.error(e);
            });
    });

    polling.create("/device/:id/poll", [access, device_middleware_param, (req, res, next) => {
        req.id = req.params.id;
        next();
    }]);

    router.delete("/device/:id", access, device_middleware_param, (req, res) => {
        req.device.commander = null;
        req.device.save()
            .then(() => res.sendStatus(StatusCodes.NO_CONTENT))
            .catch((e) => {
                res.sendStatus(StatusCodes.INTERNAL_SERVER_ERROR);
                console.error(e);
            });
    });

    // Manage state (for Items)

    router.get("/state", access, device_middleware_auth, (req, res) => {
        res.send(req.device.state);
    });

    router.put("/state", access, device_middleware_auth, (req, res) => {
        req.device.state = req.device.state || {};
        req.device.state.direction = false;
        req.device.state.message = req.body.message;
        req.device.state.update_at = ctx.now();
        req.device.save()
            .then(() => {
                res.sendStatus(StatusCodes.NO_CONTENT);
                polling.publishToId("/device/:id/poll", req.device._id, req.device.state);
            })
            .catch((e) => {
                res.sendStatus(StatusCodes.INTERNAL_SERVER_ERROR);
                console.error(e);
            });
    });

    polling.create("/state/poll", [access, device_middleware_auth, (req, res, next) => {
        req.id = req.device._id;
        next();
    }]);

    // Mount
    r.use("/automate", router);
};
