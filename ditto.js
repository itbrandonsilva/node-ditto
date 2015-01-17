var http = require('http');
var uuid = require("node-uuid");

var WatchJS = require("watchjs");
var unwatch = WatchJS.unwatch;
var callWatchers = WatchJS.callWatchers;
var watch = WatchJS.watch;

var Utils = {};
Utils.hashToArr = function (hash) {
    var arr = [];
    Object.keys(hash).forEach(function (key) {
        arr.push(hash[key]);
    });
    return arr;
};
Utils.mergeObjects = function (n, o) {
    Object.keys(n).forEach(function (k) {
        o[k] = n[k];
    });
};


var DittoObject = function (obj, ditto, options) {
    options = options || {};

    // _id = How the server will identify this object.
    // <optional> _type = How clients will identify what kind of object this is.
    // <optional> _client = Only this client has knowledge of this object.
    // <optional> _owner = Id of client who can write to this object.
    // <optional> _public = Any client can write to this object.
    
    this._ditto = ditto;
    this.data = obj;
    this._id = options.id || uuid.v1();
    this._type = options.type;
    this._client = options.client;
    this._owner = options.owner;
    this._public = options.public;
    this._new = true;
    this._getTags = options.getTags;

    var self = this;
    watch(this.data, function () {
        self.flag();
    }, options.depth);
    this.flag();
};

DittoObject.prototype.getData       =   function () { return this.data; };
DittoObject.prototype.getId         =   function () { return this._id; };
DittoObject.prototype.getType       =   function () { return this._type; };
DittoObject.prototype.getClient     =   function () { return this._client; };
DittoObject.prototype.getOwner      =   function () { return this._owner; };
DittoObject.prototype.getPublic     =   function () { return this._public; };

DittoObject.prototype.isNew = function (bool) {
    var isNew = this._new;
    this._new = bool;
    return isNew;
};

DittoObject.prototype.callWatchers = function () {
    callWatchers(this.data);
};

DittoObject.prototype.flag = function () {
    this._ditto.flag(this);
};

DittoObject.prototype.overwrite = function (data) {
    this.flag();
};

DittoObject.prototype.unref = function () {
    this._ditto.unref(this._id);
    unwatch(this.data);
    delete this._ditto;
};

var DittoSocket = function (socket, ditto, options) {
    options = options || {};
    this._socket = socket;
    this._ditto = ditto;
    this._msgCount = 0;
    this.id = socket.id
    //this.emit = this._socket.emit;
    this.lastMsg = false;

    var self = this;
    this._socket.on("ditto_sync", function () {
        self._handleSync(arguments[0]);
    });
};

DittoSocket.prototype._handleSync = function (data) {
    this._ditto.receive(this, data);
    this.lastMsg = data.msgId;
};

var Ditto = function (options) {
    options = options || {};

    this._map = {};
    this._flagged = [];
    this._sockets = {};
    this._onReceive = options.onReceive;
};

Ditto.prototype.register = function (obj, options) {
    options = options || {};
    if (options.id && this._map[options.id]) return console.error("Object of id \"" + options.id + "\" already exists in this ditto instance.");
    var obj = new DittoObject(obj, this, options);
    this._map[obj.getId()] = obj;
    return obj;
};

Ditto.prototype.getById = function (id) {
    var dittoObject = this._map[id];
    if (dittoObject) {
        return dittoObject.data;
    }
};

Ditto.prototype.unref = function (id) {
    delete this._map[id];
};

Ditto.prototype.flag = function (dittoObject) {
    this._flagged.push(dittoObject);
};

Ditto.prototype.addClient = function (socket, options) {
    options = options || {};
    socket.id = options.id || socket.id;
    socket = new DittoSocket(socket, this);
    this._sockets[socket.id] = socket;
    this.broadcast(socket);
};

Ditto.prototype.removeClient = function (id) {
    // If id is a socket.
    id = id.id || id;

    var socket =  this._sockets[id];
    if (socket) {
        delete this._sockets[id];
    } else console.error("No socket of id \"" + id + "\" was found in this ditto instance.");
};

Ditto.prototype._getObjectArray = function () {
    return Utils.hashToArr(this._map);
};

Ditto.prototype._getSocketArray = function () {
    return Utils.hashToArr(this._sockets);
};


Ditto.prototype.callWatchers = function () {
    this._getObjectArray().forEach(function (object) {
        object.callWatchers();
    });
};

Ditto.prototype.broadcast = function (socket) {
    this.callWatchers();
    var flagged; var sockets;
    if (socket) {
        flagged = this._getObjectArray();
        sockets = [socket];
    } else {
        flagged = this._flagged;
        sockets = this._getSocketArray();
    }

    sockets.forEach(function (socket) {
        var compiled = {data: [], lastMsg: socket.lastMsg};
        flagged.forEach(function (flagged) {
            var clientId = flagged.getClient();
            var ownerId = flagged.getOwner()
            var pkg = {data: flagged.getData(), id: flagged.getId(), type: flagged.getType(), lastMsg: socket.lastMsg, tags: {}, writable: false};
            if ( (!clientId) || (socket.id === clientId) ) compiled.data.push(pkg); else return;
            if (socket.id === ownerId) {
                pkg.writable = true;
            }
            if (flagged._getTags) pkg.tags = flagged._getTags(socket.id);
        });
        if ( ! compiled.data.length ) return;
        socket._socket.emit("ditto_sync", compiled);
    });
    if (!socket) this._flagged = [];
};

Ditto.prototype.receive = function (dittoSocket, data) {
    var socketId = dittoSocket.id;

    var self = this;
    dittoSocket.lastMsg = data.msgId;
    if (data.data) data.data.forEach(function (obj) {
        var dittoObject = self._map[obj.id];
        if ( ! dittoObject ) return console.error("Client requested to modify an object that does not exist.");
        if ( ! dittoObject.getOwner() == socketId ) return console.error("Client requested to modify object in which write permissions were NOT given.");
        Utils.mergeObjects(obj.data, dittoObject.data);
        if (self._onReceive) self._onReceive(dittoObject, data.msgId);
    });
};

module.exports = Ditto;
