const mysql = require('mysql2/promise');
const { Connector } = require('@google-cloud/cloud-sql-connector');

const SQL_DEBUG = process.env.SQL_DEBUG === 'true';
const SQL_DEBUG_RESULTS = process.env.SQL_DEBUG_RESULTS === 'true';
const DB_TARGET = (process.env.DB_TARGET || 'google').toLowerCase();

function now() {
  return new Date().toISOString();
}

function formatSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function logQueryStart(source, sql, params) {
  if (!SQL_DEBUG) return;

  console.log(`\n[${now()}] [SQL:${source}]`);
  console.log('QUERY :', formatSql(sql));
  console.log('PARAMS:', Array.isArray(params) ? params : []);
}

function logQuerySuccess(source, startedAt, result) {
  if (!SQL_DEBUG) return;

  const duration = Date.now() - startedAt;
  console.log(`STATUS: OK (${duration}ms)`);

  if (SQL_DEBUG_RESULTS) {
    try {
      const [rowsOrResult] = result;

      if (Array.isArray(rowsOrResult)) {
        console.log(`ROWS  : ${rowsOrResult.length}`);
      } else if (rowsOrResult && typeof rowsOrResult === 'object') {
        console.log('RESULT:', rowsOrResult);
      }
    } catch {
      console.log('RESULT: <unable to summarize>');
    }
  }
}

function logQueryError(source, startedAt, sql, params, error) {
  if (!SQL_DEBUG) return;

  const duration = Date.now() - startedAt;
  console.error(`STATUS: ERROR (${duration}ms)`);
  console.error('QUERY :', formatSql(sql));
  console.error('PARAMS:', Array.isArray(params) ? params : []);
  console.error('ERROR :', error.message);
}

async function runLoggedQuery(fn, source, sql, params = []) {
  const startedAt = Date.now();
  logQueryStart(source, sql, params);

  try {
    const result = await fn(sql, params);
    logQuerySuccess(source, startedAt, result);
    return result;
  } catch (error) {
    logQueryError(source, startedAt, sql, params, error);
    throw error;
  }
}

let rawPool = null;

function ensurePool() {
  if (!rawPool) {
    throw new Error('Database pool has not been initialized. Call initializePool() before using the database.');
  }
}

function getEnvValue(key, fallbackKey) {
  const direct = process.env[key];
  if (direct !== undefined && direct !== '') {
    return direct;
  }

  if (!fallbackKey) {
    return undefined;
  }

  const fallback = process.env[fallbackKey];
  if (fallback !== undefined && fallback !== '') {
    return fallback;
  }

  return undefined;
}

function requireEnvValue(key, fallbackKey) {
  const value = getEnvValue(key, fallbackKey);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}${fallbackKey ? ` (or ${fallbackKey})` : ''}`);
  }

  return value;
}

async function initializeLocalPool() {
  const host = requireEnvValue('LOCAL_DB_HOST', 'DB_HOST');
  const port = Number(getEnvValue('LOCAL_DB_PORT', 'DB_PORT') || 3306);
  const user = requireEnvValue('LOCAL_DB_USER', 'DB_USER');
  const password = requireEnvValue('LOCAL_DB_PASS', 'DB_PASS');
  const database = requireEnvValue('LOCAL_DB_NAME', 'DB_NAME');

  rawPool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    dateStrings: true,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  console.log(`Connected to local MySQL at ${host}:${port}`);
}

async function initializeGooglePool() {
  const instanceConnectionName = requireEnvValue('GOOGLE_INSTANCE_CONNECTION_NAME', 'INSTANCE_CONNECTION_NAME');
  const privateIpEnabled = getEnvValue('GOOGLE_PRIVATE_IP', 'PRIVATE_IP') === 'true';
  const user = requireEnvValue('GOOGLE_DB_USER', 'DB_USER');
  const password = requireEnvValue('GOOGLE_DB_PASS', 'DB_PASS');
  const database = requireEnvValue('GOOGLE_DB_NAME', 'DB_NAME');

  const connector = new Connector();

  const clientOpts = await connector.getOptions({
    instanceConnectionName,
    ipType: privateIpEnabled ? 'PRIVATE' : 'PUBLIC',
  });

  rawPool = mysql.createPool({
    ...clientOpts,
    user,
    password,
    database,
    dateStrings: true,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  console.log('Connected to Google Cloud SQL');
}

async function initializePool() {
  try {
    if (DB_TARGET === 'local') {
      await initializeLocalPool();
      return;
    }

    if (DB_TARGET === 'google') {
      await initializeGooglePool();
      return;
    }

    throw new Error(`Unsupported DB_TARGET "${DB_TARGET}". Use "local" or "google".`);
  } catch (error) {
    console.error(`Failed to initialize database pool for target "${DB_TARGET}":`, error);
    throw error;
  }
}

async function query(sql, params = []) {
  ensurePool();
  return runLoggedQuery(rawPool.query.bind(rawPool), 'pool', sql, params);
}

async function execute(sql, params = []) {
  ensurePool();
  return runLoggedQuery(rawPool.execute.bind(rawPool), 'pool', sql, params);
}

async function getConnection() {
  ensurePool();

  const connection = await rawPool.getConnection();

  const originalQuery = connection.query.bind(connection);
  const originalExecute = connection.execute.bind(connection);
  const originalBegin = connection.beginTransaction.bind(connection);
  const originalCommit = connection.commit.bind(connection);
  const originalRollback = connection.rollback.bind(connection);
  const originalRelease = connection.release.bind(connection);

  connection.query = async (sql, params = []) => {
    return runLoggedQuery(originalQuery, 'connection', sql, params);
  };

  connection.execute = async (sql, params = []) => {
    return runLoggedQuery(originalExecute, 'connection', sql, params);
  };

  connection.beginTransaction = async () => {
    if (SQL_DEBUG) console.log(`\n[${now()}] [TX] BEGIN`);
    return originalBegin();
  };

  connection.commit = async () => {
    if (SQL_DEBUG) console.log(`[${now()}] [TX] COMMIT`);
    return originalCommit();
  };

  connection.rollback = async () => {
    if (SQL_DEBUG) console.log(`[${now()}] [TX] ROLLBACK`);
    return originalRollback();
  };

  connection.release = () => {
    if (SQL_DEBUG) console.log(`[${now()}] [TX] RELEASE`);
    return originalRelease();
  };

  return connection;
}

async function end() {
  if (rawPool) {
    return rawPool.end();
  }
}

module.exports = {
  query,
  execute,
  getConnection,
  end,
  initializePool
};
