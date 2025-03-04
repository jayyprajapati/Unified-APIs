const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const notesSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
  },
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  tag: {
    type: String,
  },
  date: {
    type: Date,
    default: Date.now,
  },
});

const Note = mongoose.model("notes", notesSchema);

Note.createIndexes();
module.exports = Note;
