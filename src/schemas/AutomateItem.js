"use strict";

const mongoose = require('mongoose');

const Schema = mongoose.Schema;

module.exports = new Schema({
    id: String,
    assign_code: Number,
    feature: Array,
    state: {
        direction: Boolean,
        message: String,
        update_at: Number
    },
    commander: {
        id: String,
        assign_at: Number
    },
    created_at: Number,
});