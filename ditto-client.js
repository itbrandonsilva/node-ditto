var DittoObject = function (obj, client, options) {
    options = options || {};
    this.id = obj.id;
    this.type = obj.type;
    this.data = obj.data;
    this._isNew = true;
    this._client = client;
    this._writable = options.writeable;

    var self = this;
    watch(this.data, function (prop, action, newvalue, oldvalue) {
        if ( ! action ) return;
        WatchJS.noMore = true;
        self._client.flag(self);
    });
}

DittoObject.prototype.callWatchers = function () {
    callWatchers(this.data);
};

DittoObject.prototype.isNew = function () {
    var isNew = this._isNew;
    this._isNew = false;
    return isNew;
};

var DittoClient = function (options) {
    options = options || {};
    this._socket = io.connect(options.host, {reconnection: false});
    this._id = this._socket.id;
    this._onSync = options.onSync;
    this._objects = {};
    this._flagged = [];
    this._history = {};
    this._msgId = -1;

    var self = this;
    this._socket.on("ditto_sync", function (data) { self._handleSync(data); });
};

DittoClient.prototype.flag = function (dittoObject) {
    if (this._flagged.indexOf(dittoObject) < 0) this._flagged.push(dittoObject);
};

DittoClient.prototype._handleSync = function (clientData) {
    var self = this;
    clientData.data.forEach(function (obj) {
        var dittoObject = self._objects[obj.id];
        if ( ! dittoObject ) {
            dittoObject = self._objects[obj.id] = new DittoObject(obj, self);
        } else {
            if ( ! obj.writable ) Object.keys(obj.data).forEach(function (key) {
                dittoObject.data[key] = obj.data[key];
            });
        }

        obj.isNew = dittoObject.isNew();
    });

    window.dispatchEvent(new CustomEvent("ditto_consume", {
        detail: {last_message: clientData.lastMsg},
    }));

    clientData.data.forEach(function (obj) {
        if (self._onSync) self._onSync(obj);
    });
};

DittoClient.prototype.callWatchers = function () {
    var self = this;
    Object.keys(this._objects).forEach(function(objectId) {
        self._objects[objectId].callWatchers();
    });
};

DittoClient.prototype.broadcast = function () {
    this.callWatchers();

    if ( ! this._flagged.length ) return;

    this._msgId++;

    var data = {id: this._id, msgId: this._msgId, data: []};

    this._flagged.forEach(function (dittoObject) {
        var pkg = {id: dittoObject.id, data: dittoObject.data};
        data.data.push(pkg);
    });

    if (this._flagged.length) {
        window.dispatchEvent(new CustomEvent("ditto_broadcast", {
            detail: {message_id: this._msgId},
        }));
    }

    this._flagged = [];

    this._socket.emit("ditto_sync", data);
    return this._msgId;
};
