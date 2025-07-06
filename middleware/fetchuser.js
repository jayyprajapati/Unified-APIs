const jwt = require("jsonwebtoken");
require("dotenv").config();

const JWT_KEY = process.env.REACT_APP_JWT_SIGNATURE_KEY;

const fetchuser = (req, res, next) => {
  const token = req.header("auth-token");
  if (!token) {
    const error = new Error("Invalid token");
    error.statusCode = 401;
    return next(error);
  }

  try {
    const decoded = jwt.verify(token, JWT_KEY);
    req.user = decoded.user;
    next();
  } catch (err) {
    const error = new Error("Invalid token");
    error.statusCode = 401;
    return next(error);
  }
};

module.exports = fetchuser;
