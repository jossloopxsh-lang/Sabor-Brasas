import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const { Pool } = pg;

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false } });

const PRODUCTS = [
  ['clasica','Clásica',85,'Carne, pan, queso americano, lechuga, cebolla asada, chiles, mayonesa y catsup','burger.jpg'],
  ['hawaiana','Hawaiana',95,'Carne, pan, queso Chihuahua, piña, jamón, lechuga, cebolla asada, chiles, mayonesa y catsup','burger.jpg'],
  ['salchiburger','Salchiburger',105,'Carne, pan, queso Chihuahua, salchichón, lechuga, cebolla asada, chiles, mayonesa y catsup','burger.jpg'],
  ['doble-carne','Doble carne',120,'Doble carne, pan, queso Chihuahua, queso americano, lechuga, cebolla asada, chiles, mayonesa y catsup','burger.jpg'],
  ['dogo-clasico','Dogo clásico',75,'Salchichón, pan, queso Chihuahua, cebolla asada, chiles, mayonesa y catsup','dogo.jpg'],
  ['dogo-hawaiano','Dogo hawaiano',85,'Salchichón, pan, queso Chihuahua, piña, jamón, cebolla asada, chiles, mayonesa y catsup','dogo.jpg'],
  ['dogo-arrachero','Dogo arrachero',95,'Salchichón, arrachera, pan, queso Chihuahua, cebolla asada, chiles, mayonesa y catsup','dogo.jpg'],
  ['orden-arrachera','Orden de arrachera',70,'Orden de arrachera','tacos.jpg'],
  ['taco-arrachera','Taco de arrachera',20,'Taco de arrachera','tacos.jpg'],
  ['orden-salchichon','Orden de salchichón',50,'Orden de salchichón','tacos.jpg'],
  ['taco-salchichon','Taco de salchichón',15,'Taco de salchichón','tacos.jpg'],
  ['francesas-sencillas','Francesas sencillas',55,'Papas francesas sencillas','salchipapa.jpg'],
  ['francesas-parmesano','Francesas parmesano',65,'Papas francesas con parmesano','salchipapa.jpg'],
  ['francesas-gratinadas','Francesas gratinadas',75,'Papas francesas gratinadas','salchipapa.jpg'],
  ['salchipapa','Salchipapa',90,'Papas gratinadas con queso Chihuahua, salchichón, catsup y chiles toreados','salchipapa.jpg'],
  ['alitas','Alitas',100,'Orden de alitas. Sabor: natural, BBQ, Buffalo, mango habanero, chiltepín o parmesano.','alitas.jpg'],
  ['boneless','Boneless',105,'Orden de boneless. Sabor: natural, BBQ, Buffalo, mango habanero, chiltepín o parmesano.','alitas.jpg']
].map(([id,name,price,description,image])=>({id,name,price,description,image}));
const byId = new Map(PRODUCTS.map(p=>[p.id,p]));

function jsonError(res,status,message){ return res.status(status).json({ok:false,error:message}); }
function cents(mx){ return Math.round(Number(mx)*100); }
function money(c){ return (c/100).toFixed(2); }
function makeId(){ return 'SB-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase(); }
function sign(value){ return crypto.createHmac('sha256',SESSION_SECRET).update(value).digest('hex'); }
function setAdminCookie(res){ const payload = Buffer.from(JSON.stringify({iat:Date.now()})).toString('base64url'); const token = `${payload}.${sign(payload)}`; res.cookieHeader = `sb_admin=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`; res.setHeader('Set-Cookie',res.cookieHeader); }
function isAdmin(req){
  if(!ADMIN_PASSWORD || !SESSION_SECRET) return false;
  const raw = req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('sb_admin='))?.slice(9);
  if(!raw) return false;
  const [payload,mac] = raw.split('.'); if(!payload||!mac) return false;
  const expected=sign(payload); if(mac.length!==expected.length || !crypto.timingSafeEqual(Buffer.from(mac),Buffer.from(expected))) return false;
  try { const data=JSON.parse(Buffer.from(payload,'base64url').toString()); return Date.now()-data.iat < 86400000; } catch { return false; }
}
function requireAdmin(req,res,next){ if(!isAdmin(req)) return jsonError(res,401,'No autorizado'); next(); }

app.use(express.json({limit:'100kb'}));
app.use(express.static(path.join(__dirname,'public')));

app.get('/api/products',(req,res)=>res.json({products:PRODUCTS}));
app.get('/api/health',async(req,res)=>{ try{await pool.query('SELECT 1');res.json({ok:true});}catch(e){res.status(503).json({ok:false});} });

app.post('/api/admin/login',(req,res)=>{
  const {password}=req.body||{};
  if(!ADMIN_PASSWORD || password!==ADMIN_PASSWORD) return jsonError(res,401,'Contraseña incorrecta');
  setAdminCookie(res); res.json({ok:true});
});
app.post('/api/admin/logout',(req,res)=>{res.setHeader('Set-Cookie','sb_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');res.json({ok:true});});
app.get('/api/admin/me',requireAdmin,(req,res)=>res.json({ok:true}));

app.post('/api/orders',async(req,res)=>{
  try{
    const {customerName,phone,address,coordinates='',notes='',items}=req.body||{};
    const paymentMethod='cash';
    if(!customerName?.trim()||!phone?.trim()||!address?.trim()) return jsonError(res,400,'Nombre, teléfono y dirección son obligatorios.');
    if(!coordinates || !/^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/.test(String(coordinates))) return jsonError(res,400,'La ubicación GPS es obligatoria para realizar el pedido.');
    if(!Array.isArray(items)||!items.length) return jsonError(res,400,'El carrito está vacío.');
    const normalized=[];
    for(const item of items){
      const p=byId.get(String(item.productId)); const q=Number(item.quantity);
      if(!p || !Number.isInteger(q) || q<1 || q>50) return jsonError(res,400,'Producto o cantidad inválida.');
      normalized.push({p,q});
    }
    const totalCents=normalized.reduce((s,x)=>s+cents(x.p.price)*x.q,0);
    const id=makeId();
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query(`INSERT INTO orders(id,customer_name,phone,address,coordinates,notes,payment_method,total_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,customerName.trim(),phone.trim(),address.trim(),coordinates||null,notes?.trim()||null,paymentMethod,totalCents]);
      for(const x of normalized) await client.query(`INSERT INTO order_items(order_id,product_id,product_name,unit_cents,quantity) VALUES($1,$2,$3,$4,$5)`,[id,x.p.id,x.p.name,cents(x.p.price),x.q]);
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}

    return res.json({ok:true,orderId:id,paymentUrl:null,total:money(totalCents),paymentMethod:'cash'});
  }catch(e){console.error(e);jsonError(res,500,'Error interno al crear el pedido.');}
});

// Online payments are intentionally disabled. This store accepts cash on delivery only.

app.get('/api/orders/:id/status',async(req,res)=>{const r=await pool.query('SELECT id,payment_status,fulfillment_status,total_cents FROM orders WHERE id=$1',[req.params.id]);if(!r.rowCount)return jsonError(res,404,'Pedido no encontrado');res.json({ok:true,order:{...r.rows[0],total:money(r.rows[0].total_cents)}})});

app.get('/api/admin/orders',requireAdmin,async(req,res)=>{
  const limit=Math.min(Math.max(Number(req.query.limit||100),1),200);
  const r=await pool.query(`SELECT o.*, COALESCE(json_agg(json_build_object('productId',i.product_id,'name',i.product_name,'quantity',i.quantity,'unit',i.unit_cents)) FILTER (WHERE i.id IS NOT NULL),'[]') items FROM orders o LEFT JOIN order_items i ON i.order_id=o.id GROUP BY o.id ORDER BY o.created_at DESC LIMIT $1`,[limit]);
  res.json({ok:true,orders:r.rows.map(o=>({...o,total:money(o.total_cents)}))});
});
app.patch('/api/admin/orders/:id',requireAdmin,async(req,res)=>{
  const allowed=['new','preparing','ready','delivering','delivered','cancelled']; const s=req.body?.fulfillmentStatus;
  if(!allowed.includes(s)) return jsonError(res,400,'Estado inválido');
  const r=await pool.query('UPDATE orders SET fulfillment_status=$1, coordinates=CASE WHEN $1=\'delivered\' THEN NULL ELSE coordinates END WHERE id=$2 RETURNING id,fulfillment_status,coordinates',[s,req.params.id]);
  if(!r.rowCount)return jsonError(res,404,'Pedido no encontrado');
  res.json({ok:true,order:r.rows[0]});
});

app.patch('/api/admin/orders/:id/payment',requireAdmin,async(req,res)=>{
  const paid=req.body?.paid;
  if(typeof paid!=='boolean') return jsonError(res,400,'Valor de pago inválido');
  const r=await pool.query('UPDATE orders SET payment_status=$1 WHERE id=$2 AND payment_method=\'cash\' RETURNING id,payment_status',[paid?'paid':'pending',req.params.id]);
  if(!r.rowCount)return jsonError(res,404,'Pedido no encontrado');
  res.json({ok:true,order:r.rows[0]});
});

app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));

app.listen(PORT,()=>console.log(`Sabor & Brasas en http://localhost:${PORT}`));
