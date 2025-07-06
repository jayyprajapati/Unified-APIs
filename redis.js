const { connectRedis, getRedisClient } = require('./services/redisService');

module.exports = { connectRedisCloud: connectRedis, redisClient: getRedisClient() };