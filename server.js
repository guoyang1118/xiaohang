var express = require('express');
var cors = require('cors');
var initSqlJs = require('sql.js');
var fs = require('fs');
var path = require('path');

var app = express();
app.use(cors());
app.use(express.json());

var DB_FILE = path.join(__dirname, 'data.db');
var db;
var adminOnline = false; // 管理员在线状态
var adminLastSeen = Date.now();

var goods = [
  {name:"愈美片",price:25},{name:"普瑞巴林胶囊",price:40},{name:"富马酸喹硫平",price:20},
  {name:"阿普唑仑",price:50},{name:"地分诺酯片",price:135},{name:"文拉法辛缓释胶囊",price:40},
  {name:"右左匹克隆片",price:50},{name:"唑吡坦片",price:75},{name:"曲马多片（泰版）",price:68},
  {name:"劳拉西泮",price:50},{name:"复方甘草片",price:65},{name:"右美沙芬片",price:80}
];

async function initDB() {
  var SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    var buf = fs.readFileSync(DB_FILE);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  db.run("CREATE TABLE IF NOT EXISTS users (username TEXT, password TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS cart (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, productIndex INTEGER, specIndex INTEGER DEFAULT 0, quantity INTEGER DEFAULT 1, selected INTEGER DEFAULT 1)");
  db.run("CREATE TABLE IF NOT EXISTS addresses (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, name TEXT, phone TEXT, addr TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, orderId TEXT, items TEXT, price REAL, status TEXT, time TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, message TEXT, fromUser INTEGER, time TEXT)");
  saveDB();
}

function saveDB() {
  var data = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

function getRows(sql) {
  var r = db.exec(sql);
  if (!r.length) return [];
  var cols = r[0].columns;
  return r[0].values.map(function(v) {
    var o = {};
    cols.forEach(function(c, i) { o[c] = v[i]; });
    return o;
  });
}

// 心跳检测：管理员每10秒请求一次，表示在线
app.get('/api/admin/heartbeat', function(req, res) {
  adminOnline = true;
  adminLastSeen = Date.now();
  res.json({ online: true });
});

// 检查管理员是否在线（超过15秒没心跳视为离线）
app.get('/api/admin/online', function(req, res) {
  if (Date.now() - adminLastSeen > 15000) adminOnline = false;
  res.json({ online: adminOnline });
});

// ========== 用户端 API ==========

app.post('/api/auth/register', function(req, res) {
  var u = req.body.username;
  var rows = getRows("SELECT username FROM users WHERE username='" + u + "'");
  if (rows.length) return res.json({ msg: 'yicunzai' });
  db.run("INSERT INTO users VALUES (?,?)", [u, req.body.password]);
  saveDB();
  res.json({ token: u, username: u });
});

app.post('/api/auth/login', function(req, res) {
  var u = req.body.username, p = req.body.password;
  var rows = getRows("SELECT * FROM users WHERE username='" + u + "' AND password='" + p + "'");
  if (!rows.length) return res.json({ msg: 'cuowu' });
  res.json({ token: u, username: u });
});

app.get('/api/cart', function(req, res) {
  var token = req.headers['x-auth-token'];
  if (!token) return res.json([]);
  res.json(getRows("SELECT * FROM cart WHERE username='" + token + "'"));
});

app.post('/api/cart/add', function(req, res) {
  var token = req.headers['x-auth-token'];
  var pi = req.body.productIndex, si = req.body.specIndex||0, qty = req.body.quantity||1;
  var rows = getRows("SELECT * FROM cart WHERE username='" + token + "' AND productIndex=" + pi + " AND specIndex=" + si);
  if (rows.length) {
    db.run("UPDATE cart SET quantity=quantity+" + qty + " WHERE id=" + rows[0].id);
  } else {
    db.run("INSERT INTO cart (username,productIndex,specIndex,quantity,selected) VALUES (?,?,?,?,1)", [token, pi, si, qty]);
  }
  saveDB();
  res.json({ msg: 'ok' });
});

app.put('/api/cart/:id', function(req, res) {
  var token = req.headers['x-auth-token'];
  if (req.body.quantity) db.run("UPDATE cart SET quantity=" + req.body.quantity + " WHERE id=" + req.params.id + " AND username='" + token + "'");
  saveDB();
  res.json({ msg: 'ok' });
});

app.put('/api/cart/toggle/:id', function(req, res) {
  var token = req.headers['x-auth-token'];
  db.run("UPDATE cart SET selected=1-selected WHERE id=" + req.params.id + " AND username='" + token + "'");
  saveDB();
  res.json({ msg: 'ok' });
});

app.delete('/api/cart/:id', function(req, res) {
  var token = req.headers['x-auth-token'];
  db.run("DELETE FROM cart WHERE id=" + req.params.id + " AND username='" + token + "'");
  saveDB();
  res.json({ msg: 'ok' });
});

app.get('/api/address', function(req, res) {
  var token = req.headers['x-auth-token'];
  if (!token) return res.json([]);
  res.json(getRows("SELECT * FROM addresses WHERE username='" + token + "'"));
});

app.post('/api/address', function(req, res) {
  var token = req.headers['x-auth-token'];
  db.run("INSERT INTO addresses (username,name,phone,addr) VALUES (?,?,?,?)", [token, req.body.name, req.body.phone, req.body.addr]);
  saveDB();
  res.json({ msg: 'ok' });
});

app.delete('/api/address/:id', function(req, res) {
  var token = req.headers['x-auth-token'];
  db.run("DELETE FROM addresses WHERE id=" + req.params.id + " AND username='" + token + "'");
  saveDB();
  res.json({ msg: 'ok' });
});

app.post('/api/orders/create', function(req, res) {
  var token = req.headers['x-auth-token'];
  var items = getRows("SELECT * FROM cart WHERE username='" + token + "' AND selected=1");
  if (!items.length) return res.json({ msg: 'kong' });
  var itemsStr = items.map(function(c) { return c.productIndex + ',' + c.specIndex + ',' + c.quantity; }).join(';');
  var total = items.length * 50;
  var orderId = 'DH' + Date.now().toString(36).toUpperCase();
  var now = new Date();
  var time = now.getFullYear()+'-'+(now.getMonth()+1)+'-'+now.getDate();
  db.run("INSERT INTO orders (username,orderId,items,price,status,time) VALUES (?,?,?,?,?,?)", [token, orderId, itemsStr, total, 'daifahuo', time]);
  db.run("DELETE FROM cart WHERE username='" + token + "' AND selected=1");
  saveDB();
  res.json({ orderId: orderId, items: itemsStr, price: total, status: 'daifahuo', time: time });
});

app.get('/api/orders', function(req, res) {
  var token = req.headers['x-auth-token'];
  if (!token) return res.json([]);
  res.json(getRows("SELECT * FROM orders WHERE username='" + token + "' ORDER BY id DESC"));
});

// 客服：获取聊天记录 + 管理员在线状态
app.get('/api/chat', function(req, res) {
  var token = req.headers['x-auth-token'];
  if (!token) return res.json({ messages: [], online: false });
  var msgs = getRows("SELECT * FROM chat WHERE username='" + token + "' ORDER BY id ASC");
  if (Date.now() - adminLastSeen > 15000) adminOnline = false;
  res.json({ messages: msgs, online: adminOnline });
});

// 用户发送消息
app.post('/api/chat/send', function(req, res) {
  var token = req.headers['x-auth-token'];
  if (!token) return res.json({ msg: '未登录' });
  var now = new Date();
  var time = now.getFullYear()+'-'+(now.getMonth()+1)+'-'+now.getDate()+' '+now.getHours()+':'+String(now.getMinutes()).padStart(2,'0');
  db.run("INSERT INTO chat (username,message,fromUser,time) VALUES (?,?,1,?)", [token, req.body.message, time]);
  saveDB();
  res.json({ msg: 'ok' });
});

// 用户轮询新消息（只返回管理员发的消息）
app.get('/api/chat/poll', function(req, res) {
  var token = req.headers['x-auth-token'];
  if (!token) return res.json([]);
  var since = req.query.since || 0;
  var msgs = getRows("SELECT * FROM chat WHERE username='" + token + "' AND fromUser=0 AND id>" + since + " ORDER BY id ASC");
  res.json(msgs);
});

// ========== 后台管理 API ==========

app.post('/api/admin/login', function(req, res) {
  var u = req.body.username, p = req.body.password;
  if (u === 'admin' && p === 'admin123') {
    adminOnline = true;
    adminLastSeen = Date.now();
    res.json({ token: 'admin_token', username: u });
  } else {
    res.json({ msg: 'cuowu' });
  }
});

app.get('/api/admin/users', function(req, res) {
  var token = req.headers['x-auth-token'];
  if (!token) return res.json([]);
  var rows = getRows("SELECT * FROM users");
  var result = rows.map(function(u) {
    var cnt = getRows("SELECT COUNT(*) as cnt FROM orders WHERE username='" + u.username + "'");
    return { username: u.username, password: u.password, orderCount: cnt[0] ? cnt[0].cnt : 0 };
  });
  res.json(result);
});

app.get('/api/admin/orders', function(req, res) {
  var token = req.headers['x-auth-token'];
  if (!token) return res.json([]);
  res.json(getRows("SELECT * FROM orders ORDER BY id DESC"));
});

app.get('/api/admin/users/:username/orders', function(req, res) {
  var token = req.headers['x-auth-token'];
  if (!token) return res.json([]);
  res.json(getRows("SELECT * FROM orders WHERE username='" + req.params.username + "' ORDER BY id DESC"));
});

app.get('/api/admin/users/:username/addresses', function(req, res) {
  var token = req.headers['x-auth-token'];
  if (!token) return res.json([]);
  res.json(getRows("SELECT * FROM addresses WHERE username='" + req.params.username + "'"));
});

app.put('/api/admin/orders/:orderId/status', function(req, res) {
  var token = req.headers['x-auth-token'];
  if (!token) return res.json({ msg: '未登录' });
  db.run("UPDATE orders SET status='" + req.body.status + "' WHERE orderId='" + req.params.orderId + "'");
  saveDB();
  res.json({ msg: 'ok' });
});

app.get('/api/admin/chat/:username', function(req, res) {
  var token = req.headers['x-auth-token'];
  if (!token) return res.json([]);
  res.json(getRows("SELECT * FROM chat WHERE username='" + req.params.username + "' ORDER BY id ASC"));
});

app.post('/api/admin/chat/send', function(req, res) {
  var token = req.headers['x-auth-token'];
  if (!token) return res.json({ msg: '未登录' });
  var now = new Date();
  var time = now.getFullYear()+'-'+(now.getMonth()+1)+'-'+now.getDate()+' '+now.getHours()+':'+String(now.getMinutes()).padStart(2,'0');
  db.run("INSERT INTO chat (username,message,fromUser,time) VALUES (?,?,0,?)", [req.body.username, req.body.message, time]);
  saveDB();
  res.json({ msg: 'ok' });
});

app.get('/', function(req, res) { res.send('ok'); });

initDB().then(function() {
  app.listen(5000, function() {
    console.log('服务器已启动，端口 5000');
  });
});