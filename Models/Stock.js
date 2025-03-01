const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const StockSchema = Schema({
    name: String,
    data: Object,
});

const Stock = mongoose.model("stock", StockSchema);
Stock.createIndexes();

module.exports = Stock;