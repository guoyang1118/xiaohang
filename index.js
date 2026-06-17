var express = require('express');
var cors = require('cors');
var { MongoClient, ServerApiVersion } = require('mongodb');

var app = express();
app.use(cors());
app.use(express.json());

var uri = 'mongodb+srv://admin:qTDRR6mgWIZWbjZF@cluster0.led5jtt.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
var client = new MongoClient(uri);
var db;

var goods = [
  {name:"愈美片",price:25},{name:"普瑞巴林胶囊",price:40},{name:"富马酸喹硫平",price:20},
  {name:"阿普唑仑",price:50},{name:"地分诺酯片",price:135},{name:"文拉法辛缓释胶囊",price:40},
  {name:"右左匹克隆片",price:50},{name:"唑吡坦片",price:75},{name:"曲马多片（泰版）",price:68},
  {name:"劳拉西泮",price:50},{name:"复方甘草片",price:65},{name:"右美沙芬片",price:80}
];

var adminOnline = false, adminLastSeen = Date.now();

async function initDB() {
  await client.connect();
  db = client.db('xiaohang');
  console.log('MongoDB connected');
}

// ========== 用户端 API ==========

app.post('/api/auth/register', async function(req, res) {
  var u = req.body.username, p = req.body.password;
  var exist = await db.collection('users').findOne({ username: u });
  if (exist) return res.json({ msg: 'yicunzai' });
  await db.collection('users').insertOne({ username: u, password: p });
  res.json({ token: u, username: u });
});

app.post('/api/auth/login', async function(req, res) {
  var u = req.body.username, p = req.body.password;
  var user = await db.collection('users').findOne({ username: u, password: p });
  if (!user) return res.json({ msg: 'cuowu' });
  res.json({ token: u, username: u });
});

app.get('/api/cart', async function(req, res) {
  var token = req.headers['x-auth-token'];
  if (!token) return res.json([]);
  var cart = await db.collection('cart').find({ username: token }).toArray();
  cart.forEach(function(c) { c.id = c._id.toString(); });
  res.json(cart);
});

app.post('/api/cart/add', async function(req, res) {
  var token = req.headers['x-auth-token'];
  var pi = req.body.productIndex, si = req.body.specIndex||0, qty = req.body.quantity||1;
  var exist = await db.collection('cart').findOne({ username: token, productIndex: pi, specIndex: si });
  if (exist) {
    await db.collection('cart').updateOne({ _id: exist._id }, { $inc: { quantity: qty } });
  } else {
    await db.collection('cart').insertOne({ username: token, productIndex: pi, specIndex: si, quantity: qty, selected: 1 });
  }
  res.json({ msg: 'ok' });
});

app.put('/api/cart/:id', async function(req, res) {
  var token = req.headers['x-auth-token'];
  var { ObjectId } = require('mongodb');
  if (req.body.quantity) await db.collection('cart').updateOne({ _id: new ObjectId(req.params.id), username: token }, { $set: { quantity: req.body.quantity } });
  res.json({ msg: 'ok' });
});

app.put('/api/cart/toggle/:id', async function(req, res) {
  var token = req.headers['x-auth-token'];
  var { ObjectId } = require('mongodb');
  var item = await db.collection('cart').findOne({ _id: new ObjectId(req.params.id) });
  if (item) await db.collection('cart').updateOne({ _id: item._id }, { $set: { selected: item.selected ? 0 : 1 } });
  res.json({ msg: 'ok' });
});

app.delete('/api/cart/:id', async function(req, res) {
  var token = req.headers['x-auth-token'];
  var { ObjectId } = require('mongodb');
  await db.collection('cart').deleteOne({ _id: new ObjectId(req.params.id), username: token });
  res.json({ msg: 'ok' });
});

app.get('/api/address', async function(req, res) {
  var token = req.headers['x-auth-token'];
  if (!token) return res.json([]);
  var addrs = await db.collection('addresses').find({ username: token }).toArray();
  addrs.forEach(function(a) { a.id = a._id.toString(); });
  res.json(addrs);
});

app.post('/api/address', async function(req, res) {
  var token = req.headers['x-auth-token'];
  await db.collection('addresses').insertOne({ username: token, name: req.body.name, phone: req.body.phone, addr: req.body.addr });
  res.json({ msg: 'ok' });
});

app.delete('/api/address/:id', async function(req, res) {
  var token = req.headers['x-auth-token'];
  var { ObjectId } = require('mongodb');
  await db.collection('addresses').deleteOne({ _id: new ObjectId(req.params.id), username: token });
  res.json({ msg: 'ok' });
});

app.post('/api/orders/create', async function(req, res) {
  var token = req.headers['x-auth-token'];
  var items = await db.collection('cart').find({ username: token, selected: 1 }).toArray();
  if (!items.length) return res.json({ msg: 'kong' });
  var itemsStr = items.map(function(c) { return c.productIndex + ',' + c.specIndex + ',' + c.quantity; }).join(';');
  var orderId = 'DH' + Date.now().toString(36).toUpperCase();
  var total = items.length * 50;
  var now = new Date();
  var time = now.getFullYear()+'-'+(now.getMonth()+1)+'-'+now.getDate();
  await db.collection('orders').insertOne({ username: token, orderId: orderId, items: itemsStr, price: total, status: 'daifahuo', time: time });
  await db.collection('cart').deleteMany({ username: token, selected: 1 });
  res.json({ orderId: orderId, price: total, status: 'daifahuo', time: time });
});

app.get('/api/orders', async function(req, res) {
  var token = req.headers['x-auth-token'];
  if (!token) return res.json([]);
  res.json(await db.collection('orders').find({ username: token }).sort({ _id: -1 }).toArray());
});

app.get('/api/chat', async function(req, res) {
  var token = req.headers['x-auth-token'];
  if (!token) return res.json({ messages: [], online: false });
  var msgs = await db.collection('chat').find({ username: token }).sort({ _id: 1 }).toArray();
  res.json({ messages: msgs, online: Date.now()-adminLastSeen<15000 });
});

app.post('/api/chat/send', async function(req, res) {
  var token = req.headers['x-auth-token'];
  var now = new Date();
  var time = now.getFullYear()+'-'+(now.getMonth()+1)+'-'+now.getDate()+' '+now.getHours()+':'+String(now.getMinutes()).padStart(2,'0');
  await db.collection('chat').insertOne({ username: token, message: req.body.message, fromUser: 1, time: time });
  res.json({ msg: 'ok' });
});

// ========== 后台管理 API ==========

app.post('/api/admin/login', function(req, res) {
  if (req.body.username === 'admin' && req.body.password === 'admin123') {
    adminOnline = true; adminLastSeen = Date.now();
    return res.json({ token: 'admin_token' });
  }
  res.json({ msg: 'cuowu' });
});

app.get('/api/admin/heartbeat', function(req, res) { adminOnline = true; adminLastSeen = Date.now(); res.json({ online: true }); });
app.get('/api/admin/online', function(req, res) { res.json({ online: Date.now()-adminLastSeen<15000 }); });

app.get('/api/admin/users', async function(req, res) {
  var users = await db.collection('users').find().toArray();
  var result = [];
  for (var u of users) {
    var cnt = await db.collection('orders').countDocuments({ username: u.username });
    result.push({ username: u.username, password: u.password, orderCount: cnt });
  }
  res.json(result);
});

app.get('/api/admin/orders', async function(req, res) {
  res.json(await db.collection('orders').find().sort({ _id: -1 }).toArray());
});

app.get('/api/admin/users/:username/orders', async function(req, res) {
  res.json(await db.collection('orders').find({ username: req.params.username }).sort({ _id: -1 }).toArray());
});

app.get('/api/admin/users/:username/addresses', async function(req, res) {
  var addrs = await db.collection('addresses').find({ username: req.params.username }).toArray();
  res.json(addrs);
});

app.put('/api/admin/orders/:orderId/status', async function(req, res) {
  await db.collection('orders').updateOne({ orderId: req.params.orderId }, { $set: { status: req.body.status } });
  res.json({ msg: 'ok' });
});

app.get('/api/admin/chat/:username', async function(req, res) {
  res.json(await db.collection('chat').find({ username: req.params.username }).sort({ _id: 1 }).toArray());
});

app.post('/api/admin/chat/send', async function(req, res) {
  var now = new Date();
  var time = now.getFullYear()+'-'+(now.getMonth()+1)+'-'+now.getDate()+' '+now.getHours()+':'+String(now.getMinutes()).padStart(2,'0');
  await db.collection('chat').insertOne({ username: req.body.username, message: req.body.message, fromUser: 0, time: time });
  res.json({ msg: 'ok' });
});

initDB().then(function() {
  app.listen(5000, function() { console.log('5000'); });
});