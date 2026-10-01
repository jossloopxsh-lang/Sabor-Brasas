# Sabor & Brasas — paquete completo

## 1) Probar el diseño sin servidor
Abre `cliente_preview.html` directamente en Chrome.
Puedes:
- agregar productos al carrito
- probar el checkout
- permitir ubicación
- crear pedidos de prueba
- abrir `🔐 Ver pedidos (demo)` para ver cómo se verá el panel

Los pedidos de esta DEMO se guardan únicamente en el navegador mediante localStorage.

## 2) Versión real
La carpeta contiene también el servidor profesional. Para producción:
- Node.js
- PostgreSQL
- HTTPS
- ADMIN_PASSWORD
- variables de entorno
- publicación en un hosting

La versión real debe ser la que reciba y guarde los pedidos. No uses localStorage como sistema de producción.
