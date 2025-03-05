const express = require('express');
const { Server } = require('socket.io');
const Docker = require('dockerode');
const { Buffer } = require('buffer');
// const cors = require('cors');
const { Session } = require('../Models/Session');
const { verifySession, sessionExists, getSession, removeUserFromSession, isCodeSafe} = require('../middleware/SessionManagement')

module.exports = (httpsServer) => {
  const router = express.Router();
  // router.use(cors({
  //   origin: 'https://codehive.jayprajapati.me', // Split comma-separated values
  //   methods: ['GET', 'POST', 'PUT', 'DELETE'],
  //   allowedHeaders: ['Content-Type', 'Authorization'],
  //   // credentials: true
  // }));

  // router.options('*', cors());
  // router.options('*', (req, res) => {
  //   res.header('Access-Control-Allow-Origin', '*');
  //   res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  //   res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  //   res.sendStatus(200); 
  // });
  const io = new Server(httpsServer, {
    cors: {
      origin: "https://*.jayprajapati.me",
      methods: ["GET", "POST"],
      allowedHeaders: ["Authorization"],
      credentials: true
    },
    transports: ['websocket']
  });

  const docker = new Docker();

  // HTTP Routes
  // router.post('/verify-session', async(req, res) => {
  //   const { sessionId, password } = req.body;
  //   if (!(await sessionExists(sessionId))) {
  //     return res.status(404).json({ valid: false, error: 'Session does not exist' });
  //   }
  //   if (!(await verifySession(sessionId, password))) {
  //     return res.status(401).json({ valid: false, error: 'Invalid password' });
  //   }
  //   res.json({ valid: true });
  // });

  // router.post('/create-session', async (req, res) => {
  //   const { sessionId, password, owner } = req.body;
  //   if (await sessionExists(sessionId)) {
  //     return res.status(400).json({ valid: false, error: 'Session ID exists' });
  //   }
  //   await createSession(sessionId, password, owner);
  //   res.json({ valid: true });
  // });

  // Socket.io Handlers
  io.on('connect', (socket) => {
    console.log('Client connected:', socket.id);
  
    socket.on('join-session', async (data) => {
      try {
        const { sessionId, password, user, userId } = data;
        const session = await getSession(sessionId);
        
        if (!(await sessionExists(sessionId)) || !(await verifySession(sessionId, password))) {
          return socket.emit('error', { message: 'Invalid session or password' });
        }
  
        
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

        const updatedSession = await getSession(sessionId);
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
            const user = session.users.find(u => u.socketId === socket.id);
            const message = {
                user: user.name,
                message: data.message,
                timestamp: new Date().toISOString()
            };

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

        if (!isCodeSafe(data.code, data.language)) {
          return io.to(data.sessionId).emit('terminal-output', {
            sessionId: data.sessionId,
            output: "Error: Code contains prohibited patterns\n"
          });
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

    socket.on('disconnect', async () => {
        try {
            const sessions = await Session.find({
                'users.socketId': socket.id
            });

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