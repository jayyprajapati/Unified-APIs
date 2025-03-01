const Redis = require('redis');

const redisClient = Redis.createClient({
    username: 'default',
    password: process.env.REDIS_CLOUD_PASSWORD,
    socket: {
        host: process.env.REDIS_CLOUD_HOST,
        port: process.env.REDIS_CLOUD_PORT
    }
});

const connectRedisCloud = async () => {
    await redisClient.connect();
    console.log("redis connect successful");
}

module.exports = {connectRedisCloud, redisClient};