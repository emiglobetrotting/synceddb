var mysql = require('mysql');
var Promise = require('bluebird');
Promise.promisifyAll(mysql);
Promise.promisifyAll(require('mysql/lib/Connection').prototype);
Promise.promisifyAll(require('mysql/lib/Pool').prototype);

function getNewKey(con) {
  return con.queryAsync(
    'SELECT MAX(`key`) AS `max` FROM synceddb_changes'
  ).spread(function(res) {
    return (res[0].max !== null) ? res[0].max + 1 : 0;
  });
}

function mysqlPersistence(opts) {
  this.connection = mysql.createConnection(opts);
  this.connection.connect();
  this.connection.queryAsync(
    'CREATE TABLE IF NOT EXISTS `synceddb_changes` ' +
    '(`timestamp` INT NOT NULL AUTO_INCREMENT PRIMARY KEY, ' +
    '`key` INT NOT NULL, ' +
    '`version` INT NOT NULL, ' +
    '`storename` VARCHAR(255) NOT NULL, ' +
    '`type` TEXT NOT NULL, ' +
    //'`type` ENUM("create", "update", "delete") NOT NULL, ' +
    '`data` TEXT NOT NULL)'
  );
}

var processChange = {
  create: function(change, data, con) {
    change.version = 0;
    data.record = change.record;
    return getNewKey(con).then(function(nK) {
      change.key = nK;
    });
  },
  update: function(change, data) {
    data.diff = change.diff;
    change.version++;
    return Promise.resolve();
  },
  delete: function(change, data) {
    change.version++;
    return Promise.resolve();
  },
};

mysqlPersistence.prototype.saveChange = function(change) {
  var data = {};
  var con = this.connection;
  return processChange[change.type](change, data, con).then(function() {
    var dataStr = JSON.stringify(data);
    return con.queryAsync(
      'INSERT INTO synceddb_changes (`key`, version, storename, type, data) ' +
      'VALUES (?, ?, ?, ?, ?)',
      [change.key, change.version, change.storeName, change.type, dataStr]
    );
  }).then(function(res) {
    change.timestamp = res[0].insertId;
    return change;
  });
};

mysqlPersistence.prototype.getChanges = function(req) {
  var con = this.connection;
  var since = req.since === null ? -1 : req.since;
  return con.queryAsync(
    'SELECT * FROM synceddb_changes WHERE storename = ? AND timestamp > ?',
    [req.storeName, since]
  ).spread(function(res) {
    return res.map(function(r) {
      r.data = JSON.parse(r.data);
      r.data.key = r.key;
      r.data.timestamp = r.timestamp;
      r.data.storeName = r.storename;
      r.data.type = r.type;
      r.data.version = r.version;
      return r.data;
    });
  });
};

mysqlPersistence.prototype.getChangesToRecord = function(change) {
};

mysqlPersistence.prototype.resetChanges = function(change) {
  var con = this.connection;
  return con.queryAsync('DELETE FROM synceddb_changes').then(function() {
    return con.queryAsync('ALTER TABLE synceddb_changes AUTO_INCREMENT = 1');
  });
};

module.exports = mysqlPersistence;
