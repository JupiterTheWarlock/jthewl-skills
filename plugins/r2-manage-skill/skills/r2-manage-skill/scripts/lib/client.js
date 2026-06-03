#!/usr/bin/env node
/**
 * R2 Manage — S3 客户端单例工厂
 */

const { S3Client } = require('@aws-sdk/client-s3');
const { loadConfig } = require('./config');

let _client = null;
let _config = null;

function getClient() {
  if (!_client) {
    _config = loadConfig();
    _client = new S3Client({
      region: 'auto',
      endpoint: _config.endpoint,
      credentials: {
        accessKeyId: _config.accessKeyId,
        secretAccessKey: _config.secretAccessKey,
      },
    });
  }
  return _client;
}

function getConfig() {
  if (!_config) {
    getClient();
  }
  return _config;
}

module.exports = { getClient, getConfig };
