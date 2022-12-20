const express = require("express");
const User = require("../Models/User");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fetchuser = require("../middleware/fetchuser");
const { body, validationResult } = require("express-validator");

const JWT_KEY =
  "thisisasecretkeycreatedbyjayprajapatiandsomerandomcharlike@#$%";

// ––––––––––––––––––––––––––Route: 1––––––––––––––––––––––––––
// create a new user via POST("/api/auth/signup"). No login required
router.post(
  "/signup",
  // to validate the user data
  [
    body("name", "Enter a valid name").isLength({ min: 3 }),
    body("email").isEmail(),
    body("password").isLength({ min: 6 }),
  ],
  async (req, res) => {
    // check for the errors
    let success = false;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.json({
        success,
        errors: errors.array(),
        message: "Invalid Input",
      });
    }
    try {
      //  Check if the user already exists with the same email
      let user = await User.findOne({ email: req.body.email });
      if (user) {
        return res.json({
          success,
          errors: [{ msg: "User already exists" }],
          message: "User already exists",
        });
      }

      // if no errors then create a new user
      const salt = await bcrypt.genSalt(10);
      const securedPassword = await bcrypt.hash(req.body.password, salt);

      user = await User.create({
        name: req.body.name,
        email: req.body.email,
        password: securedPassword,
      });

      const data = {
        user: {
          id: user.id,
        },
      };
      const authToken = jwt.sign(data, JWT_KEY);
      success = true;
      res.json({ success, authToken, message: "Login Successful" });
    } catch (error) {
      console.error(error.message);
      res.json({ success, message: "Some Internal error occurred" });
    }
  }
);

// ––––––––––––––––––––––––––Route: 2––––––––––––––––––––––––––
// User Login via POST("/api/auth/login"). No login required
router.post(
  "/login",
  // to validate the user data
  [body("email").isEmail(), body("password").exists()],
  async (req, res) => {
    let success = false;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.json({
        success,
        errors: errors.array(),
        message: "Enter a valid data",
      });
    }
    try {
      const { email, password } = req.body;

      //  Check if the user already exists with the same email
      let user = await User.findOne({ email });
      if (!user) {
        return res.json({
          success,
          errors: [{ error: "Please use correct email credentials" }],
          message: "Please use correct email credentials",
        });
      }

      // if no errors then create a new user
      const validatePass = await bcrypt.compare(password, user.password);

      if (!validatePass) {
        return res.json({
          success,
          errors: [{ error: "Please use correct password credentials" }],
          message: "Please use correct password credentials",
        });
      }

      const data = {
        user: {
          id: user.id,
        },
      };
      const authToken = jwt.sign(data, JWT_KEY);
      success = true;
      res.json({ success, authToken, message: "Login Successful" });
    } catch (error) {
      console.error(error.message);
      res.status(500).json({ message: "Some Internal error occurred" });
    }
  }
);

// ––––––––––––––––––––––––––Route: 3––––––––––––––––––––––––––
// User Login via POST("/api/auth/getuser"). No login required
router.post("/getuser", fetchuser, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).select("-password");
    res.json({ user });
  } catch (error) {
    console.error(error.message);
    res.status(500).send("some error occurred");
  }
});
module.exports = router;
