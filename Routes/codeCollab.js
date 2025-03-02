const express = require('express');
const { Server } = require('socket.io');
const crypto = require('crypto');
const Docker = require('dockerode');
const base64 = require('base64url');
const { Buffer } = require('buffer');

module.exports = (httpServer) => {
  const router = express.Router();
  const io = new Server(httpServer, {
    cors: {
      origin: "http://localhost:5173",
      methods: ["GET", "POST"],
      allowedHeaders: ["Authorization"],
      credentials: true
    }
  });

  const docker = new Docker();
  const sessions = new Map();

  // Session helpers
  function createSession(sessionId, password, owner) {
    sessions.set(sessionId, {
      users: new Map(),
      code: '// New session started...',
      chat: [],
      password: crypto.createHash('sha256').update(password).digest('hex'),
      owner,
      createdAt: new Date(),
      active: true
    });
  }

  function verifySession(sessionId, password) {
    const session = sessions.get(sessionId);
    if (!session || !session.active) return false;
    return session.password === crypto.createHash('sha256').update(password).digest('hex');
  }

  function sessionExists(sessionId) {
    return sessions.has(sessionId);
  }

  function getSession(sessionId) {
    return sessions.get(sessionId);
  }

  // HTTP Routes
  router.post('/verify-session', (req, res) => {
    const { sessionId, password } = req.body;
    if (!sessionExists(sessionId)) {
      return res.status(404).json({ valid: false, error: 'Session does not exist' });
    }
    if (!verifySession(sessionId, password)) {
      return res.status(401).json({ valid: false, error: 'Invalid password' });
    }
    res.json({ valid: true });
  });

  router.post('/create-session', (req, res) => {
    console.log('request body', req.body);
    const { sessionId, password, owner } = req.body;
    if (sessionExists(sessionId)) {
      return res.status(400).json({ valid: false, error: 'Session ID exists' });
    }
    createSession(sessionId, password, owner);
    res.json({ valid: true });
  });

  // Socket.io Handlers
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
  
    socket.on('join-session', (data) => {
      try {
        const { sessionId, password, user, userId } = data;
        if (!sessionExists(sessionId) || !verifySession(sessionId, password)) {
          return socket.emit('error', { message: 'Invalid session or password' });
        }
  
        const session = sessions.get(sessionId);
        const isOwner = userId === session.owner;
        
        session.users.set(socket.id, {
          name: user,
          id: userId,
          role: isOwner ? 'owner' : 'editor'
        });
  
        socket.join(sessionId);
        const userList = Array.from(session.users.values()).map(u => ({
          name: u.name,
          role: u.role
        }));
        
        io.to(sessionId).emit('user-list', userList);
        socket.broadcast.to(sessionId).emit('user-joined', { user });
        socket.emit('session-data', {
          code: session.code,
          chat: session.chat,
          role: session.users.get(socket.id).role
        });
      } catch (error) {
        socket.emit('error', { message: 'Internal server error' });
      }
    });

    socket.on('change-role', (data) => {
        const { sessionId, targetUser, newRole } = data;
        const session = getSession(sessionId);
        
        if (session) {
          const requester = session.users.get(socket.id);
          
          if (requester?.role === 'owner') {
            for (const [sid, user] of session.users) {
              if (user.name === targetUser) {
                user.role = newRole;
                io.to(sessionId).emit('role-updated', {
                  user: targetUser,
                  newRole: newRole
                });
                break;
              }
            }
          }
        }
    });

    socket.on('end-session', (data) => {
        console.log("session end signal received")
        const { sessionId, userId } = data;
        const session = getSession(sessionId);
        if (session?.owner === userId) {
          session.active = false;
          io.to(sessionId).emit('session-ended');
          sessions.delete(sessionId);
          console.log(sessions);
        }
    });

    socket.on('leave-session', (sessionId) => {
        const session = getSession(sessionId);
        
        if (session) {
          const user = session.users.get(socket.id);
          if (user) {
            socket.leave(sessionId);
            session.users.delete(socket.id);
            io.to(sessionId).emit('user-left', {
              user: user.name,
              message: `${user.name} has left the session`
            });
          }
        }
    });
  
    socket.on('code-change', (data) => {
      const session = sessions.get(data.sessionId);
      if (session) {
        session.code = data.code;
        socket.broadcast.to(data.sessionId).emit('code-update', data.code);
      }
    });
  
    socket.on('send-chat-message', (data) => {
      const session = sessions.get(data.sessionId);
      if (session) {
        const user = session.users.get(socket.id);
        const message = {
          user: user.name,
          message: data.message,
          timestamp: new Date().toISOString()
        };
        session.chat.push(message);
        io.to(data.sessionId).emit('chat-message', message);
      }
    });
  
    socket.on('run-code', async (data) => {
        const { sessionId, code, language } = data;
        const encodedCode = Buffer.from(code).toString('base64');
    
        try {
          // Language configuration (memory in bytes)
          const langConfig = {
            python: {
              image: 'python:3.9',
              fileExt: 'py',
              memLimit: 100 * 1024 * 1024, // 100MB in bytes
              runCmd: 'python -u /app/code.py'
            },
            javascript: {
              image: 'node:16',
              fileExt: 'js',
              memLimit: 100 * 1024 * 1024, // 100MB
              runCmd: 'node /app/code.js'
            },
            java: {
              image: 'openjdk:17',
              fileExt: 'java',
              memLimit: 512 * 1024 * 1024, // 512MB
              runCmd: 'sh -c "javac /app/code.java && java -cp /app code"'
            }
          };
    
          const config = langConfig[language];
          if (!config) {
            throw new Error(`Unsupported language: ${language}`);
          }
    
          // Create container with proper configuration
          const container = await docker.createContainer({
            Image: config.image,
            Cmd: [
              'sh', '-c',
              `mkdir -p /app && ` +
              `echo "${encodedCode}" | base64 -d > /app/code.${config.fileExt} && ` +
              `${config.runCmd}`
            ],
            HostConfig: {
              Memory: config.memLimit,
              NetworkMode: 'none'
            },
            AttachStdout: true,
            AttachStderr: true,
            Tty: false
          });
    
          // Start container
          await container.start();
    
          // Stream logs
          const stream = await container.logs({
            follow: true,
            stdout: true,
            stderr: true
          });
    
          stream.on('data', (chunk) => {
            io.to(sessionId).emit('terminal-output', {
              sessionId,
              output: chunk.toString()
            });
          });
    
          // Wait for container to exit
          const exitCode = await container.wait();
          
          // Emit completion
          io.to(sessionId).emit('execution-complete', { sessionId });
    
          // Cleanup
          await container.remove();
    
        } catch (error) {
          console.error('Execution error:', error);
          io.to(sessionId).emit('terminal-output', {
            sessionId,
            output: `Execution error: ${error.message}\n`
          });
        }
    });

    socket.on('code-executed', (data) => {
        try {
          // --- Validation Checks ---
          // Uncomment these if needed:
          // if (data?.output?.length > MAX_OUTPUT_LENGTH) {
          //   socket.emit('error', { message: 'Output too large' });
          //   return;
          // }
          
          // if (!validateSessionOwnership(data?.sessionId, socket.id)) {
          //   socket.emit('error', { message: 'Unauthorized' });
          //   return;
          // }
    
          // --- Session Validation ---
          const session = sessions.get(data?.sessionId);
          if (!session) {
            return; // Silent fail or add error emit
          }
    
          // --- User Permission Check ---
          const user = session.users.get(socket.id);
          if (!user || !['owner', 'editor'].includes(user.role)) {
            return; // Silent fail or add error emit
          }
    
          // --- Output Handling ---
          const truncatedOutput = data.output 
            ? data.output.slice(0, 1000) 
            : '';
    
          // --- Broadcast Result ---
          io.to(data.sessionId).emit('execution-result', {
            output: truncatedOutput,
            user: user.name,
            timestamp: new Date().toISOString()
          });
    
        } catch (error) {
          console.error(`Execution broadcast error: ${error.message}`);
          // Optionally send error to client:
          // socket.emit('error', { message: 'Processing failed' });
        }
      });
  
    socket.on('disconnect', () => {
      sessions.forEach((session, sessionId) => {
        if (session.users.has(socket.id)) {
          const user = session.users.get(socket.id).name;
          session.users.delete(socket.id);
          
          io.to(sessionId).emit('user-left', { 
            user,
            message: `${user} has left the session`
          });
  
          if (session.users.size === 0) {
            sessions.delete(sessionId);
          }
        }
      });
    });
  });

  return router;
};


// const express = require('express');
// const router = express.Router();
// const { Server } = require('socket.io');
// const crypto = require('crypto');
// const Docker = require('dockerode');
// const base64 = require('base64url');

// const io = new Server(httpServer, {
//   cors: {
//     origin: "*",
//     methods: ["GET", "POST"]
//   }
// });

// const docker = new Docker();
// const sessions = new Map();
// // const MAX_OUTPUT_LENGTH = 1000;

// app.use(cors({
//   origin: 'http://localhost:5173',
//   methods: ['GET', 'POST']
// }));
// app.use(express.json());

// // Session helpers
// function createSession(sessionId, password, owner) {
//   sessions.set(sessionId, {
//     users: new Map(),
//     code: '// New session started...',
//     chat: [],
//     password: crypto.createHash('sha256').update(password).digest('hex'),
//     owner,
//     createdAt: new Date(),
//     active: true
//   });
// }

// function verifySession(sessionId, password) {
//   const session = sessions.get(sessionId);
//   if (!session || !session.active) return false;
//   return session.password === crypto.createHash('sha256').update(password).digest('hex');
// }

// function sessionExists(sessionId) {
//   return sessions.has(sessionId);
// }

// // HTTP Routes
// app.post('/verify-session', (req, res) => {
//   const { sessionId, password } = req.body;
//   if (!sessionExists(sessionId)) {
//     return res.status(404).json({ valid: false, error: 'Session does not exist' });
//   }
//   if (!verifySession(sessionId, password)) {
//     return res.status(401).json({ valid: false, error: 'Invalid password' });
//   }
//   res.json({ valid: true });
// });

// app.post('/create-session', (req, res) => {
//   const { sessionId, password, owner } = req.body;
//   if (sessionExists(sessionId)) {
//     return res.status(400).json({ valid: false, error: 'Session ID exists' });
//   }
//   createSession(sessionId, password, owner);
//   res.json({ valid: true });
// });

// // Socket.io Handlers
// io.on('connection', (socket) => {
//   console.log('Client connected:', socket.id);

//   socket.on('join-session', (data) => {
//     try {
//       const { sessionId, password, user, userId } = data;
//       if (!sessionExists(sessionId) || !verifySession(sessionId, password)) {
//         return socket.emit('error', { message: 'Invalid session or password' });
//       }

//       const session = sessions.get(sessionId);
//       const isOwner = userId === session.owner;
      
//       session.users.set(socket.id, {
//         name: user,
//         id: userId,
//         role: isOwner ? 'owner' : 'editor'
//       });

//       socket.join(sessionId);
//       const userList = Array.from(session.users.values()).map(u => ({
//         name: u.name,
//         role: u.role
//       }));
      
//       io.to(sessionId).emit('user-list', userList);
//       socket.broadcast.to(sessionId).emit('user-joined', { user });
//       socket.emit('session-data', {
//         code: session.code,
//         chat: session.chat,
//         role: session.users.get(socket.id).role
//       });
//     } catch (error) {
//       socket.emit('error', { message: 'Internal server error' });
//     }
//   });

//   socket.on('code-change', (data) => {
//     const session = sessions.get(data.sessionId);
//     if (session) {
//       session.code = data.code;
//       socket.broadcast.to(data.sessionId).emit('code-update', data.code);
//     }
//   });

//   socket.on('send-chat-message', (data) => {
//     const session = sessions.get(data.sessionId);
//     if (session) {
//       const user = session.users.get(socket.id);
//       const message = {
//         user: user.name,
//         message: data.message,
//         timestamp: new Date().toISOString()
//       };
//       session.chat.push(message);
//       io.to(data.sessionId).emit('chat-message', message);
//     }
//   });

//   socket.on('run-code', async (data) => {
//     const { sessionId, code, language } = data;
//     const session = sessions.get(sessionId);
    
//     try {
//       let image, fileExt, runCmd, memLimit;
//       switch(language) {
//         case 'python':
//           image = 'python:3.9';
//           fileExt = 'py';
//           runCmd = 'python -u /app/code.py';
//           memLimit = '100m';
//           break;
//         case 'javascript':
//           image = 'node:16';
//           fileExt = 'js';
//           runCmd = 'node /app/code.js';
//           memLimit = '100m';
//           break;
//         case 'java':
//           image = 'openjdk:17';
//           fileExt = 'java';
//           runCmd = 'javac /app/code.java && java -cp /app code';
//           memLimit = '512m';
//           break;
//         default:
//           throw new Error('Unsupported language');
//       }

//       const container = await docker.createContainer({
//         Image: image,
//         Cmd: ['sh', '-c', 
//           `mkdir -p /app && ` +
//           `echo "${base64(code)}" | base64 -d > /app/code.${fileExt} && ` +
//           `${runCmd}`],
//         AttachStdout: true,
//         AttachStderr: true,
//         HostConfig: {
//           Memory: memLimit,
//           NetworkMode: 'none'
//         }
//       });

//       await container.start();
      
//       const stream = await container.logs({ 
//         follow: true, 
//         stdout: true, 
//         stderr: true 
//       });
      
//       stream.on('data', (chunk) => {
//         io.to(sessionId).emit('terminal-output', {
//           sessionId,
//           output: chunk.toString()
//         });
//       });

//       stream.on('end', async () => {
//         io.to(sessionId).emit('execution-complete', { sessionId });
//         await container.remove({ force: true });
//       });
//     } catch (error) {
//       io.to(sessionId).emit('terminal-output', {
//         sessionId,
//         output: `Execution error: ${error.message}\n`
//       });
//     }
//   });

//   socket.on('disconnect', () => {
//     sessions.forEach((session, sessionId) => {
//       if (session.users.has(socket.id)) {
//         const user = session.users.get(socket.id).name;
//         session.users.delete(socket.id);
        
//         io.to(sessionId).emit('user-left', { 
//           user,
//           message: `${user} has left the session`
//         });

//         if (session.users.size === 0) {
//           sessions.delete(sessionId);
//         }
//       }
//     });
//   });
// });

// module.exports = router;