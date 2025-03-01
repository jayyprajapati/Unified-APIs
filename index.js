const connectToMongo = require("./db");
const { connectRedisCloud } = require("./redis");
const express = require("express");
const cors = require("cors");
const bodyParser = require('body-parser');
require("dotenv").config();
connectToMongo();
connectRedisCloud();

const app = express();
const port = process.env.PORT || 8000;
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send("Hello World!");
});

// Available Routes
app.use("/api/auth/", require("./Routes/auth"));
app.use("/api/notes/", require("./Routes/notes"));
app.use("/api/stocks/", require("./Routes/stocks"));

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
