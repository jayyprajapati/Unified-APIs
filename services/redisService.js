const Redis = require('redis');

let redisClient = null;

const connectRedis = async () => {
    try {
        redisClient = Redis.createClient({
            username: 'default',
            password: process.env.REDIS_CLOUD_PASSWORD,
            socket: {
                host: process.env.REDIS_CLOUD_HOST,
                port: process.env.REDIS_CLOUD_PORT
            }
        });

        redisClient.on('error', (err) => console.error('Redis Client Error', err));

        await redisClient.connect();
        console.log("Redis connection successful");
    } catch (error) {
        console.error("Failed to connect to Redis:", error.message);
        redisClient = null; // Ensure redisClient is null if connection fails
    }
};

const getRedisClient = () => {
    if (!redisClient || !redisClient.isReady) {
        console.warn("Redis client not connected or ready. Operations will be bypassed.");
        return null;
    }
    return redisClient;
};

module.exports = { connectRedis, getRedisClient };
