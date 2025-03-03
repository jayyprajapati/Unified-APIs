const { Session } = require('../Models/Session');
const crypto = require('crypto');
// const NodeCache = require('node-cache');

// Create new session
async function createSession(sessionId, password, owner) {
  const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
  const session = new Session({
    sessionId,
    users: [],
    code: '// New session started...',
    chat: [],
    password: hashedPassword,
    owner,
    active: true,
    createdAt: new Date()
  });
  await session.save();
}

// Verify session exists and password matches
async function verifySession(sessionId, password) {
  const session = await Session.findOne({ sessionId });
  if (!session || !session.active) return false;
  return session.password === crypto.createHash('sha256').update(password).digest('hex');
}

// Check if session exists
async function sessionExists(sessionId) {
  return !!(await Session.findOne({ sessionId }));
}

// const sessionCache = new NodeCache({ stdTTL: 300, checkperiod: 600 });
// Get session by ID
async function getSession(sessionId) {
    return Session.findOne({ sessionId }).lean();
}

async function updateSession(sessionId, update) {
    return Session.updateOne({ sessionId }, update);
  }
  
  async function removeUserFromSession(sessionId, socketId) {
    // sessionCache.del(sessionId);
    return Session.updateOne(
      { sessionId },
      { $pull: { users: { socketId } } }
    );
  }

  module.exports = {createSession, verifySession, sessionExists, getSession, updateSession, removeUserFromSession}