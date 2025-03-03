const express = require('express');
const { Server } = require('socket.io');
const Docker = require('dockerode');
const { Buffer } = require('buffer');
const { Session } = require('../Models/Session');
const {createSession, verifySession, sessionExists, getSession, removeUserFromSession} = require('../middleware/SessionManagement')

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
//   const sessions = new Map();

  // Session helpers
//   function createSession(sessionId, password, owner) {
//     sessions.set(sessionId, {
//       users: new Map(),
//       code: '// New session started...',
//       chat: [],
//       password: crypto.createHash('sha256').update(password).digest('hex'),
//       owner,
//       createdAt: new Date(),
//       active: true
//     });
//   }

//   function verifySession(sessionId, password) {
//     const session = sessions.get(sessionId);
//     if (!session || !session.active) return false;
//     return session.password === crypto.createHash('sha256').update(password).digest('hex');
//   }

//   function sessionExists(sessionId) {
//     return sessions.has(sessionId);
//   }

//   function getSession(sessionId) {
//     return sessions.get(sessionId);
//   }

  // HTTP Routes
  router.post('/verify-session', async(req, res) => {
    const { sessionId, password } = req.body;
    if (!(await sessionExists(sessionId))) {
      return res.status(404).json({ valid: false, error: 'Session does not exist' });
    }
    if (!(await verifySession(sessionId, password))) {
      return res.status(401).json({ valid: false, error: 'Invalid password' });
    }
    res.json({ valid: true });
  });

  router.post('/create-session', async (req, res) => {
    const { sessionId, password, owner } = req.body;
    if (await sessionExists(sessionId)) {
      return res.status(400).json({ valid: false, error: 'Session ID exists' });
    }
    await createSession(sessionId, password, owner);
    res.json({ valid: true });
  });

  // Socket.io Handlers
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
  
    socket.on('join-session', async (data) => {
      try {
        const { sessionId, password, user, userId } = data;
        const session = await getSession(sessionId);
        
        if (!(await sessionExists(sessionId)) || !(await verifySession(sessionId, password))) {
          return socket.emit('error', { message: 'Invalid session or password' });
        }
  
        
        // const isOwner = userId === session.owner;
        const userEntry = {
            socketId: socket.id,
            name: user,
            userId,
            role: userId === session.owner ? 'owner' : 'editor'
        };

        await Session.updateOne(
            { sessionId },
            { $push: { users: userEntry } }
        );

        // session.users.set(socket.id, {
        //   name: user,
        //   id: userId,
        //   role: isOwner ? 'owner' : 'editor'
        // });
  
        // socket.join(sessionId);
        // const userList = Array.from(session.users.values()).map(u => ({
        //   name: u.name,
        //   role: u.role
        // }));
        const updatedSession = await getSession(sessionId);
        // console.log(updatedSession);
        console.log(updatedSession.users.map(u => ({ name: u.name, role: u.role })))
        socket.join(sessionId);
        io.to(sessionId).emit('user-list', updatedSession.users.map(u => ({ name: u.name, role: u.role })));
        socket.broadcast.to(sessionId).emit('user-joined', { user });
        socket.emit('session-data', {
            code: updatedSession.code,
            chat: updatedSession.chat,
            role: updatedSession.users.find(u => u.socketId === socket.id)?.role || 'viewer'
        });
      } catch (error) {
        socket.emit('error', { message: 'Internal server error' });
      }
    });

    socket.on('change-role', async (data) => {
        try {
            const { sessionId, targetUser, newRole } = data;
                    const session = await getSession(sessionId);
                    
                    if (session) {
                    //   const requester = session.users.get(socket.id);
                    const requester = session.users.find(u => u.socketId === socket.id);
                      
                      if (requester?.role === 'owner') {
                        await Session.findOneAndUpdate(
                            { 
                              sessionId,
                              "users.name": targetUser 
                            },
                            { $set: { "users.$.role": newRole } }
                          );
            
                        const updatedSession = await getSession(sessionId);
                        // for (const [sid, user] of session.users) {
                        //   if (user.name === targetUser) {
                        //     user.role = newRole;
                        //     io.to(sessionId).emit('role-updated', {
                        //       user: targetUser,
                        //       newRole: newRole
                        //     });
                        //     break;
                        //   }
                        // }
                        io.to(sessionId).emit('role-updated', {
                            user: targetUser,
                            newRole: newRole,
                            userList: updatedSession.users.map(u => ({
                              name: u.name,
                              role: u.role
                            }))
                          });
                      }
                    }
        } catch (error) {
            console.error('Role change error:', error);
            socket.emit('error', { message: 'Role change failed' });
          }
        
    });

    socket.on('end-session', async (data) => {
        try {
            console.log("session end signal received")
            const { sessionId, userId } = data;
            const session = await getSession(sessionId);
            if (session?.owner === userId) {
                await Session.deleteOne({ sessionId });
                console.log("session deleted");
                
                io.to(sessionId).emit('session-ended');
                // session.active = false;
                // io.to(sessionId).emit('session-ended');
                // sessions.delete(sessionId);
                // console.log(sessions);
            }
        } catch (error) {
            console.error('Session termination error:', error);
          }
        
    });

    socket.on('leave-session', async (sessionId) => {
        try {
            console.log("leave session signal received")
            const session = await getSession(sessionId);
            if (session) {
                const user = session.users.find(u => u.socketId === socket.id);
                console.log("user: ", user)
                if (user) {
                await removeUserFromSession(sessionId, socket.id);
                socket.leave(sessionId);
                console.log(user);
                // session.users.delete(socket.id);
                io.to(sessionId).emit('user-left', {
                    user: user.name,
                    message: `${user.name} has left the session`
                });
                }
            }
        } catch (error) {
            console.error('Leave session error:', error);
          }
        
    });
  
    socket.on('code-change', async (data) => {
        try {
            // const session = await getSession(data.sessionId);
            // if (session) {
            //     session.code = data.code;
            //     socket.broadcast.to(data.sessionId).emit('code-update', data.code);
            // }
            await Session.findOneAndUpdate(
                { sessionId: data.sessionId },
                { $set: { code: data.code } }
              );
              socket.broadcast.to(data.sessionId).emit('code-update', data.code);
        } catch (error) {
            console.error('Code update error:', error);
          }
      
    });
  
    socket.on('send-chat-message', async (data) => {
        try {
            const session = await getSession(data.sessionId);
            if (session) {
            // const user = session.users.get(socket.id);
            const user = session.users.find(u => u.socketId === socket.id);
            const message = {
                user: user.name,
                message: data.message,
                timestamp: new Date().toISOString()
            };

            // session.chat.push(message);
            await Session.findOneAndUpdate(
                { sessionId: data.sessionId },
                { $push: { chat: message } }
            );
            io.to(data.sessionId).emit('chat-message', message);
            }
        } catch (error) {
            console.error('Chat message error:', error);
        }
      
    });
  
    socket.on('run-code', async (data) => {
        const { sessionId, code, language } = data;
        const encodedCode = Buffer.from(code).toString('base64');

        const session = await getSession(sessionId);
        if (!session || !session.active) {
            return socket.emit('error', { message: 'Invalid session' });
        }
    
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
          await container.wait();
          
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

    // socket.on('code-executed', async (data) => {
    //     try {
    
    //       // --- Session Validation ---
    //       const session = sessions.get(data?.sessionId);
    //       if (!session) {
    //         return; // Silent fail or add error emit
    //       }
    
    //       // --- User Permission Check ---
    //       const user = session.users.get(socket.id);
    //       if (!user || !['owner', 'editor'].includes(user.role)) {
    //         return; // Silent fail or add error emit
    //       }
    
    //       // --- Output Handling ---
    //       const truncatedOutput = data.output 
    //         ? data.output.slice(0, 1000) 
    //         : '';
    
    //       // --- Broadcast Result ---
    //       io.to(data.sessionId).emit('execution-result', {
    //         output: truncatedOutput,
    //         user: user.name,
    //         timestamp: new Date().toISOString()
    //       });
    
    //     } catch (error) {
    //       console.error(`Execution broadcast error: ${error.message}`);
    //       // Optionally send error to client:
    //       socket.emit('error', { message: 'Processing failed' });
    //     }
    //   });
  
    socket.on('disconnect', async () => {
        try {
            // Find all sessions where this socket.id exists in users
            const sessions = await Session.find({
                'users.socketId': socket.id
            });
            // sessions.forEach((session, sessionId) => {
            // if (session.users.has(socket.id)) {
            //     const user = session.users.get(socket.id).name;
            //     session.users.delete(socket.id);
                
            //     io.to(sessionId).emit('user-left', { 
            //     user,
            //     message: `${user} has left the session`
            //     });
        
            //     if (session.users.size === 0) {
            //     sessions.delete(sessionId);
            //     }
            // }
            // });
            for (const session of sessions) {
                await Session.updateOne(
                  { sessionId: session.sessionId },
                  { $pull: { users: { socketId: socket.id } } }
                );
        
                const user = session.users.find(u => u.socketId === socket.id);
                if (user) {
                  io.to(session.sessionId).emit('user-left', { 
                    user: user.name,
                    message: `${user.name} has disconnected`
                  });
                }
              }
        } catch (error) {
            console.error('Disconnect cleanup error:', error);
          }
      
    });
  });

  return router;
};