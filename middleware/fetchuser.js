const jwt = require("jsonwebtoken");
require("dotenv").config();

const JWT_KEY = process.env.REACT_APP_JWT_SIGNATURE_KEY;

const fetchuser = (req, res, next) => {
  const token = req.header("auth-token");
  if (!token) {
    return res.status(401).send({ error: "Invalid token" });
  }

  try {
    const decoded = jwt.verify(token, JWT_KEY);
    req.user = decoded.user;
    next();
  } catch (err) {
    return res.status(401).send({ error: "Invalid token" });
  }
};

module.exports = fetchuser;
