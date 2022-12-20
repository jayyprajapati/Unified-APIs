const express = require("express");
const router = express.Router();
const Notes = require("../Models/Notes");
const fetchuser = require("../middleware/fetchuser");
const { body, validationResult } = require("express-validator");

// –––––––––––––––––––––––––– Route: 1 READ ––––––––––––––––––––––––––
// GET all notes of a user via GET("/api/notes/allnotes"). Login required

router.get(
  "/allnotes",
  // Validate the user
  fetchuser,
  async (req, res) => {
    let success = false;
    try {
      // Find user notes by id
      let notes = await Notes.find({ user: req.user.id });
      // Send the response
      res.send(notes);
    } catch (error) {
      res.json({ message: "Some Internal error occurred", success });
    }
  }
);

// ––––––––––––––––––––––––––Route: 2 CREATE ––––––––––––––––––––––––––
// Add new note of a user via POST("/api/notes/addnote"). Login required

router.post(
  "/addnote",
  // to validate the user data
  [
    body("title", "Enter a valid title").isLength({ min: 3 }),
    body("description", "Enter a valid description").isLength({ min: 6 }),
  ],
  // Validate the user
  fetchuser,
  async (req, res) => {
    // set Success status to false
    let success = false;
    // check for the input validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.json({ message: "Invalid Input", success });
    }
    try {
      // Get all updates for the user
      const { title, description, tag } = req.body;

      // Create a new note for the user
      const note = await Notes.create({
        title,
        description,
        tag,
        user: req.user.id,
      });
      // Save the note
      const savedNote = await note.save();
      // Set success status to true
      success = true;
      // Send response
      res.json({ savedNote, message: "Note added Successfully", success });
    } catch (error) {
      res.json({ message: "Some Internal error occurred", success });
    }
  }
);

// ––––––––––––––––––––––––––Route: 3 UPDATE ––––––––––––––––––––––––––
// UPDATE note of a user via PUT("/api/notes/updatenote/:id"). Login required
// Here the id in the URL is note id and not the user id.

router.put(
  "/updatenote/:id",
  // Validate the user
  fetchuser,
  async (req, res) => {
    // set Success status to false
    let success = false;
    try {
      // Get all updates for the user
      const { title, description, tag } = req.body;

      // Create new temp note object
      const newNote = {};

      // Set all updated attributes to new temp note
      if (title) {
        newNote.title = title;
      }
      if (description) {
        newNote.description = description;
      }
      if (tag) {
        newNote.tag = tag;
      }
      newNote.date = Date.now();
      // Search for the note using note id
      let note = await Notes.findById(req.params.id);
      // If note is not found using the note id
      if (!note) {
        return res.json({ message: "Note not found", success });
      }
      // if user id stored in note object don't match with the user id who requested.
      if (note.user.toString() !== req.user.id)
        return res.json({ message: "Not Authorized", success });

      // If no errors, UPDATE note in database
      note = await Notes.findByIdAndUpdate(
        req.params.id,
        { $set: newNote },
        { new: true }
      );
      // Set success status to true
      success = true;
      // Send response
      res.json({ note, message: "Note updated Successfully", success });
    } catch (error) {
      return res.json({ message: "Some Internal error occurred", success });
    }
  }
);

// ––––––––––––––––––––––––––Route: 4 DELETE ––––––––––––––––––––––––––
// DELETE note of a user via DELETE("/api/notes/deletenote/:id"). Login required
// Here the id in the URL is note id and not the user id.

router.delete(
  "/deletenote/:id",
  // Validate the user
  fetchuser,
  async (req, res) => {
    // set Success status to false
    let success = false;
    try {
      // Search for the note using note id
      let note = await Notes.findById(req.params.id);

      // If note is not found using the note id
      if (!note) {
        return res.json({ message: "Not Found", success });
      }

      // if user id stored in note object don't match with the user id who requested.
      if (note.user.toString() !== req.user.id)
        return res.json({ message: "Not Authorized", success });

      // If no errors, DELETE note from database
      note = await Notes.findByIdAndDelete(req.params.id);

      // Set success status to true
      success = true;
      // Send response
      res.json({
        success,
        message: "Note Deleted Successfully",
        title: note.title,
        id: note.id,
      });
    } catch (error) {
      res.json({ message: "Some Internal error occurred", success });
    }
  }
);

module.exports = router;
