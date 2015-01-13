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

var DittoObject = function (obj, ditto, options) {
    options = options || {};

    // _id = How the server will identify this object.
    // <optional> _tag = How clients will identify this object.
    // <optional> _client = Only this client has knowledge of this object.
    // <optional> _writable = Id of client who can write to this object.
    // <optional> _public = Any client can write to this object.
    
    this._ditto = ditto;
    this._data = obj;
    this._id = options.id || uuid.v1();
    this._tag = options.tag;
    this._client = options.client;
    this._writeable = options.writeable;
    this._public = options.public;

    var self = this;
    watch(this._data, function () {
        self.flag();
    }, options.depth);
};

DittoObject.prototype.getData       =   function () { return this._data; };
DittoObject.prototype.getId         =   function () { return this._id; };
DittoObject.prototype.getTag        =   function () { return this._tag; };
DittoObject.prototype.getClient     =   function () { return this._client; };
DittoObject.prototype.getWritable   =   function () { return this._writable; };
DittoObject.prototype.getPublic     =   function () { return this._public; };

DittoObject.prototype.callWatchers = function () {
    callWatchers(this._data);
};

DittoObject.prototype.flag = function () {
    this._ditto.flag(this);
};

DittoObject.prototype.set = function (key, value) {
    if ( this._data[key] !== value ) {
        this._data[key] = value;
        this._ditto.flag(this);
    }
};

DittoObject.prototype.unref = function () {
    this._ditto.unref(this._id);
    unwatch(this._data);
    this._ditto = false;
};


var Ditto = function (options) {
    options = options || {};

    this._map = {};
    this._flagged = [];
    this._sockets = {};
    this._rate = options.rate || 1;
};

Ditto.prototype.register = function (obj, options) {
    options = options || {};
    if (options.id && this._map[options.id) return console.error("Object of id \"" + options.id + "\" exists in this ditto instance.");
    var obj = new DittoObject(obj, this, options);
    this._map[obj.getId()] = obj;
    return obj;
};

Ditto.prototype.unref = function (id) {
    delete this._map[id];
};

Ditto.prototype.flag = function (dittoObject) {
    this._flagged.push(dittoObject);
};

Ditto.prototype.start = function () {
    setInterval((function (self) {
        return function () {
            if (self.update) {
                self.update(function () {
                    self.emit();
                })
            } else {
                self.emit();
            }
        };
    })(this), 1000/this._rate);
    this._started = true;
};

Ditto.prototype.addClient = function (socket, clientId) {
    var id = socket.id = clientId || socket.id;
    this._sockets[id] = socket;
    this.emit(socket);
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

Ditto.prototype.emit = function (socket) {
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
        var compiled = {data: []};
        flagged.forEach(function (flagged) {
            var clientId = flagged.getClient();
            var pkg = {data: flagged.getData(), id: flagged.getId(), tag: flagged.getTag()};
            if ( (!clientId) || (socket.id === clientId) ) compiled.data.push(pkg); else return;
            if ( flagged.getPublic() || socket.id === flagged.getWritable() ) pkg.writable = true; else pkg.writable = false;
        });
        socket.emit("data", compiled);
    });
    if (!socket) this._flagged = [];
};

module.exports = Ditto;
