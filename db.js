const mongoose = require("mongoose");
require("dotenv").config();
const mongoUserName = process.env.REACT_APP_MONGO_USERNAME;
const mongoUserPassword = process.env.REACT_APP_MONGO_USER_PASSWORD;
console.log(mongoUserName);
console.log(mongoUserPassword);
const mongoURI = `mongodb+srv://${mongoUserName}:${mongoUserPassword}@cloudnotes.bx9dv3c.mongodb.net/?retryWrites=true&w=majority`;

const connectToMongo = () => {
  mongoose.connect(mongoURI, (err) => {
    if (err) console.log(err);
    else console.log("Connected to Mongo");
  });
};

module.exports = connectToMongo;
