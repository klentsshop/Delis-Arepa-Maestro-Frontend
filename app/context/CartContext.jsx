'use client';

import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { cleanPrice } from '@/lib/utils'; // ✅ Usamos tu utilidad global

const CartContext = createContext();
const avisosDados = new Set();
const stockLocalCache = new Map();

export function CartProvider({ children }) {
  const [items, setItems] = useState([]);
  const [metodoPago, setMetodoPago] = useState('efectivo');
  const [propina, setPropina] = useState(0); // 👈 Estado para el % de propina
  const [montoManual, setMontoManual] = useState(0); // 👈 Campo "Otro" (Monto manual)
  const [tipoOrden, setTipoOrden] = useState('mesa');
  // 💾 1. Al iniciar, recuperar del navegador si existe algo (Ahora localStorage)
  // 💾 1. Al iniciar: Recuperar Carrito y Tipo de Orden del navegador
  useEffect(() => {
    // Definimos las constantes extrayendo los datos del almacenamiento
    const savedItems = localStorage.getItem('talanquera_cart');
    const savedTipo = localStorage.getItem('talanquera_tipo_orden');

    // Si hay items guardados, los cargamos
    if (savedItems) {
      try {
        const parsed = JSON.parse(savedItems);
        if (parsed && parsed.length > 0) setItems(parsed);
      } catch (e) {
        console.error("Error parseando el carrito del localStorage", e);
      }
    }

    // ✅ Si hay un tipo de orden guardado (domicilio/llevar), lo aplicamos
    if (savedTipo) {
      setTipoOrden(savedTipo);
    }

    // 🔥 SINCRONIZACIÓN ENTRE PESTAÑAS (Para que no se crucen las órdenes)
    const syncTabs = (e) => {
      if (e.key === 'talanquera_cart') {
        const newValue = e.newValue ? JSON.parse(e.newValue) : [];
        setItems(newValue);
      }
      // Sincronizar también el radio si se cambia en otra pestaña abierta
      if (e.key === 'talanquera_tipo_orden') {
        setTipoOrden(e.newValue || 'mesa');
      }
    };

    window.addEventListener('storage', syncTabs);
    return () => window.removeEventListener('storage', syncTabs);
  }, []);

  // 💾 2. Guardado Automático: Cada vez que cambien los items o el tipo de orden
  // 💾 2. Guardado Automático con "Amortiguador" (Debounce)
  // Esto evita que el sistema titile al cargar una mesa desde Sanity
  useEffect(() => {
    // Si el carrito está vacío y no hay nada en disco, no hacemos nada
    if (items.length === 0) {
        localStorage.removeItem('talanquera_cart');
        return;
    }

    // Ponemos un pequeño retraso (150ms). 
    // Si setItems se dispara muchas veces rápido, solo guardamos la última.
    const saveTimeout = setTimeout(() => {
      localStorage.setItem('talanquera_cart', JSON.stringify(items));
      localStorage.setItem('talanquera_tipo_orden', tipoOrden || 'mesa');
    }, 150);

    return () => clearTimeout(saveTimeout);
  }, [items, tipoOrden]);
  
  const addProduct = async (product) => {
    const pId = product._id || product.id;
    const insumoId = product.insumoVinculado?._ref;

    // --- 🛡️ ESCUDO PREVENTIVO (Bloqueo Síncrono) ---
    if (product.controlaInventario && insumoId) {
      const stockEnProducto = Number(product.stockActual) || 0;
      
      if (!stockLocalCache.has(insumoId) || stockEnProducto > Number(stockLocalCache.get(insumoId))) {
        stockLocalCache.set(insumoId, stockEnProducto);
      }

      const stockDisponible = Number(stockLocalCache.get(insumoId));
      const cantidadADescontar = Number(product.cantidadADescontar) || 1;

      if ((stockDisponible + 0.001) < cantidadADescontar) {
        alert(`🚫 STOCK AGOTADO LOCAL: No puedes agregar más "${product.nombre}".`);
        return; 
      }

      stockLocalCache.set(insumoId, stockDisponible - cantidadADescontar);
    }

    // --- 🍎 1. LÓGICA VISUAL ---
    const precioNum = cleanPrice(product.precio);

    setItems(prev => {
    const catActual = (product.categoria || "").trim().toUpperCase();
    const esTopping = catActual === "TOPPINGS ADICIONALES" || catActual === "TOPPINGS" || catActual === "ADICIONES";

    // A. LÓGICA DE TOPPING: Buscar la última arepa y meterse adentro
    if (esTopping) {
      const copy = [...prev];
      // Buscamos el último producto que NO sea un topping (el "Padre")
      // Nota: Puedes cambiar "AREPAS" por la categoría principal de tu cliente
      const lastPadreIdx = copy.findLastIndex(it => {
          const c = (it.categoria || "").toUpperCase();
          return c !== "TOPPINGS" && c !== "ADICIONES" && c !== "TOPPINGS ADICIONALES";
      });

      if (lastPadreIdx !== -1) {
        const padre = copy[lastPadreIdx];
        const nombreTopping = product.nombrePlato || product.nombre;
        
        // Inyectamos en el comentario
        const nuevoComentario = padre.comentario 
          ? `${padre.comentario}, +${nombreTopping}` 
          : `+${nombreTopping}`;
        
        const nuevoPrecio = padre.precioNum + precioNum;
        
        // Guardamos el insumo en la "mochila" (insumosAgrupados) para descontar stock luego
        const insumosActualizados = [
          ...(padre.insumosAgrupados || []),
          { 
            insumoId: product.insumoVinculado?._ref, 
            cantidadADevolver: Number(product.cantidadADescontar) || 1,
            nombre: product.nombrePlato || product.nombre
          }
        ];

        copy[lastPadreIdx] = { 
          ...padre, 
          comentario: nuevoComentario,
          precioNum: nuevoPrecio,
          subtotalNum: padre.cantidad * nuevoPrecio,
          insumosAgrupados: insumosActualizados 
        };
        return copy;
      }
    }

    // B. LÓGICA DE PRODUCTO PADRE (Ej: Arepa): Siempre línea nueva para recibir sus propios toppings
    if (catActual === "AREPAS") {
        return [...prev, { 
          ...product, 
          _id: pId, 
          lineId: crypto.randomUUID(), 
          cantidad: 1, 
          precioNum, 
          subtotalNum: precioNum, 
          comentario: '', 
          categoria: catActual,
          insumosAgrupados: [], // <--- MOCHILA INICIALIZADA
          seImprime: product.seImprime ?? true 
        }];
    }
    // C. AGRUPACIÓN NORMAL (Bebidas, etc.) - Tu lógica original de agrupar por ID + Comentario
    const existingIdx = prev.findIndex(it => 
      (it._id || it.id) === pId && 
      (it.comentario === (product.comentario || '')) &&
      !it._key &&
      (it.categoria || "").toUpperCase() !== "AREPAS"
    );

    if (existingIdx !== -1) {
      const copy = [...prev];
      const nCant = copy[existingIdx].cantidad + 1;
      copy[existingIdx] = { ...copy[existingIdx], cantidad: nCant, subtotalNum: nCant * precioNum };
      return copy;
    }

    // D. PRODUCTO NUEVO
   return [...prev, { 
      ...product, _id: pId, lineId: crypto.randomUUID(), 
      cantidad: 1, precioNum, subtotalNum: precioNum, 
      comentario: product.comentario || '', 
      categoria: catActual,
      insumosAgrupados: [], // <--- IMPORTANTE: Para que todo producto pueda recibir toppings
      seImprime: product.seImprime ?? true 
    }];
  });
  // --- 🛡️ 2. LÓGICA DE INVENTARIO (VERSIÓN BLINDADA) ---
    if (product.controlaInventario && insumoId) {
      fetch('/api/inventario/descontar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            insumoId, 
            cantidad: Number(product.cantidadADescontar) || 1 
        })
      })
      .then(async (res) => {
        const data = await res.json();

        // 🚨 CASO 409: EL SERVIDOR DIJO NO (Stock insuficiente)
        if (res.status === 409) {
          // ✅ BISTURÍ: No asumimos 0. Seteamos lo que el servidor diga que hay.
          stockLocalCache.set(insumoId, Number(data.disponible || 0));
          
          avisosDados.add(insumoId);

          setItems(prev => {
            // REVERSIÓN SEGURA: Solo afectamos lo que no se ha guardado (_key)
            const idx = prev.findIndex(it => 
                (it._id || it.id) === pId && 
                !it._key && 
                (it.comentario === (product.comentario || ''))
            );
            
            if (idx === -1) return prev;
            const copy = [...prev];
            if (copy[idx].cantidad > 1) {
                const nCant = copy[idx].cantidad - 1;
                copy[idx] = { ...copy[idx], cantidad: nCant, subtotalNum: nCant * precioNum };
                return copy;
            } else {
                return copy.filter((_, i) => i !== idx);
            }
          });

          alert(`🚫 STOCK AGOTADO: El servidor indica que solo quedan ${data.disponible} unidades.`);
          return;
        }

        // ✅ CASO 200: ÉXITO TOTAL
        if (res.ok) {
            // Sincronizamos el caché local con la verdad absoluta del servidor
            stockLocalCache.set(insumoId, Number(data.nuevoStock));

            if (data.alertaStockBajo && !avisosDados.has(insumoId)) {
                avisosDados.add(insumoId);
                alert(`⚠️ AVISO: Stock bajo de "${data.nombreInsumo || product.nombre}" (${data.nuevoStock} disp.)`);
            }
        }
      })
      .catch(err => {
          console.error("🔥 Error crítico inventario:", err);
          // 🛡️ Si la red falla, no dejamos que el usuario siga agregando a ciegas
          stockLocalCache.set(insumoId, 0); 
      });
    }
};
  const setCartFromOrden = (platosOrdenados = [], tipoDeSanity = 'mesa') => {
    // 🧹 Limpiamos el rastro del localStorage antes de cargar lo nuevo
    localStorage.removeItem('talanquera_cart');
    
    // Seteamos el tipo de orden inmediatamente
    setTipoOrden(tipoDeSanity);

    const reconstruido = platosOrdenados.map(p => ({
      _key: p._key,
      lineId: p._key || crypto.randomUUID(),
      _id: p._id || p.id || p.nombrePlato,
      nombre: p.nombrePlato,
      precio: cleanPrice(p.precioUnitario),
      cantidad: Number(p.cantidad) || 1,
      precioNum: cleanPrice(p.precioUnitario),
      subtotalNum: cleanPrice(p.precioUnitario) * (Number(p.cantidad) || 1),
      comentario: p.comentario || "",
      categoria: p.categoria || "",
      controlaInventario: p.controlaInventario || false,
      insumoVinculado: p.insumoVinculado || null,
      seImprime: p.seImprime === true,
      cantidadADescontar: p.cantidadADescontar || 0,
      insumosAgrupados: (p.insumosAgrupados || []).map(extra => ({
      insumoId: extra.insumoId || extra._ref, 
      cantidadADevolver: extra.cantidadADevolver,
      nombre: extra.nombre || "Adición"
  }))
    }));

    // Actualizamos el estado. El "Amortiguador" del useEffect de arriba 
    // se encargará de que esto no cause un parpadeo violento.
    setItems(reconstruido);
  };

 const decrease = async (lineId) => {
  const item = items.find(i => i.lineId === lineId);
  if (!item) return;

  const esArepa = (item.categoria || "").toUpperCase() === "AREPAS";

  // 1️⃣ PRIMERO: Limpiamos la pantalla (UI)
  // Lo sacamos del estado inmediatamente. Si el usuario da otro click, 
  // la función morirá en el "if (!item) return" de arriba.
  setItems(prev => {
    if (item.cantidad <= 1 || esArepa) {
      return prev.filter(i => i.lineId !== lineId);
    } else {
      return prev.map(i => 
        i.lineId === lineId 
          ? { ...i, cantidad: i.cantidad - 1, subtotalNum: (i.cantidad - 1) * i.precioNum } 
          : i
      );
    }
  });

  // 2️⃣ SEGUNDO: Preparamos la mochila de devolución (Lógica)
  const mapaDevolucion = new Map();
  const factorDevolucion = 1; 

  const idPrincipal = item.insumoVinculado?._ref || item.insumoId;
  if (item.controlaInventario && idPrincipal) {
    const cantPrincipal = (Number(item.cantidadADescontar) || 1) * factorDevolucion;
    mapaDevolucion.set(idPrincipal, cantPrincipal);
  }

  if (item.insumosAgrupados?.length > 0) {
    item.insumosAgrupados.forEach(ins => {
      const idT = ins.insumoId?._ref || ins.insumoId;
      if (idT) {
        const cantT = (Number(ins.cantidadADevolver) || 1) * factorDevolucion;
        mapaDevolucion.set(idT, (mapaDevolucion.get(idT) || 0) + cantT);
      }
    });
  }

  const itemsParaDevolver = Array.from(mapaDevolucion.entries()).map(([id, totalCant]) => ({
    insumoId: id,
    cantidad: totalCant
  }));

  // 3️⃣ TERCERO: Enviamos al servidor (Red)
  if (itemsParaDevolver.length > 0) {
    try {
      const res = await fetch('/api/inventario/devolver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: itemsParaDevolver })
      });
      
      if (res.ok) {
          refreshStockLocal();
          window.dispatchEvent(new Event('inventarioActualizado'));
      }
    } catch (e) { 
        console.error("❌ Error devolviendo stock:", e);
    }
  }
  
  // 🏁 AQUÍ TERMINA. No pongas ningún setItems extra aquí abajo.
};
 const clear = () => {
    setItems([]);
    setPropina(0);
    setMontoManual(0);
    setTipoOrden('mesa');
    avisosDados.clear(); // 🛡️ Limpia alertas de la mesa anterior
    stockLocalCache.clear();
    localStorage.removeItem('talanquera_cart');
    localStorage.removeItem('talanquera_mesa');
    localStorage.removeItem('talanquera_tipo_orden');
  };
  const clearWithStockReturn = async () => {
    const mapaDevolucion = new Map();

    items.forEach(it => {
      // A. Extraer ID del Plato Principal (Blindado contra objetos de Sanity)
      const idPrincipal = it.insumoVinculado?._ref || it.insumoId;
      
      if (it.controlaInventario && idPrincipal) {
        const cantPrincipal = (Number(it.cantidadADescontar) || 1) * (Number(it.cantidad) || 1);
        mapaDevolucion.set(idPrincipal, (mapaDevolucion.get(idPrincipal) || 0) + cantPrincipal);
      }

      // B. TOPPINGS (Mochila agrupada - Blindado)
      if (it.insumosAgrupados && it.insumosAgrupados.length > 0) {
        it.insumosAgrupados.forEach(ins => {
          const idTopping = ins.insumoId?._ref || ins.insumoId;
          if (idTopping) {
            const cantTopping = (Number(ins.cantidadADevolver) || 1) * (Number(it.cantidad) || 1);
            mapaDevolucion.set(idTopping, (mapaDevolucion.get(idTopping) || 0) + cantTopping);
          }
        });
      }
    });

    const itemsParaDevolver = Array.from(mapaDevolucion.entries()).map(([id, totalCant]) => ({
      insumoId: id,
      cantidad: totalCant
    }));

    if (itemsParaDevolver.length > 0) {
      try {
        const res = await fetch('/api/inventario/devolver', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: itemsParaDevolver })
        });
        if (res.ok) {
            console.log("✅ Stock total devuelto con éxito");
            refreshStockLocal(); // 🚀 Vital: Para que el ProductGrid muestre el stock recuperado
        }
      } catch (e) { 
        console.error("❌ Error stock masivo:", e); 
      }
    }
    clear(); 
  };
const eliminarLineaConStock = async (lineId) => {
    const itemABorrar = items.find(it => it.lineId === lineId);
    if (!itemABorrar) return items; 

    const nuevoCarrito = items.filter(it => it.lineId !== lineId);
    const mapaDevolucion = new Map();

    // A. Insumo del Plato Principal (Multiplicado por cantidad de la línea)
    const idPrincipal = itemABorrar.insumoVinculado?._ref || itemABorrar.insumoId;
    if (itemABorrar.controlaInventario && idPrincipal) {
        const cantPrincipal = (Number(itemABorrar.cantidadADescontar) || 1) * (Number(itemABorrar.cantidad) || 1);
        mapaDevolucion.set(idPrincipal, cantPrincipal);
    }

    // B. Insumos de los Toppings (Mochila - Multiplicado por cantidad de la línea)
    if (itemABorrar.insumosAgrupados && itemABorrar.insumosAgrupados.length > 0) {
        itemABorrar.insumosAgrupados.forEach(ins => {
            const idTopping = ins.insumoId?._ref || ins.insumoId;
            if (idTopping) {
                const cantT = (Number(ins.cantidadADevolver) || 1) * (Number(itemABorrar.cantidad) || 1);
                mapaDevolucion.set(idTopping, (mapaDevolucion.get(idTopping) || 0) + cantT);
            }
        });
    }

    const itemsParaDevolver = Array.from(mapaDevolucion.entries()).map(([id, totalCant]) => ({
        insumoId: id,
        cantidad: totalCant
    }));

    if (itemsParaDevolver.length > 0) {
        try {
            const res = await fetch('/api/inventario/devolver', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: itemsParaDevolver })
            });
            if (res.ok) window.dispatchEvent(new Event('inventarioActualizado'));
        } catch (err) { console.error("❌ Error stock línea:", err); }
    }

    setItems(nuevoCarrito);
    return nuevoCarrito; 
};
// 🚀 BISTURÍ: Esta función limpia la memoria de stock para forzar recarga
  const refreshStockLocal = () => {
    stockLocalCache.clear();
    avisosDados.clear();
    console.log("🧹 Memoria de inventario limpia. El próximo '+' pedirá datos frescos.");
  };
  // 🧮 CÁLCULO DEL TOTAL BLINDADO
  const total = useMemo(() => {
    const subtotalProductos = items.reduce((s, it) => s + (it.precioNum * it.cantidad), 0);
    
    // Si la propina es manual (-1), ignoramos porcentajes y sumamos el monto puro
    if (propina === -1) {
      return subtotalProductos + Number(montoManual);
    }
    
    const valorPropinaPorcentaje = subtotalProductos * (propina / 100);
    return subtotalProductos + valorPropinaPorcentaje;
  }, [items, propina, montoManual]);

  // ✅ BISTURÍ: Añadimos la función que falta para arreglar el POS
  const actualizarComentario = (lineId, comentario) => {
    setItems(prev =>
      prev.map(it =>
        it.lineId === lineId ? { ...it, comentario } : it
      )
    );
  };
  const contextValue = useMemo(() => ({
      items,
      addProduct,
      setCartFromOrden,
      tipoOrden,     
      setTipoOrden,
      decrease,
      clear,
      clearWithStockReturn,
      eliminarLineaConStock,
      total,
      metodoPago,
      setMetodoPago,
      propina,
      setPropina,
      montoManual,
      setMontoManual,
      actualizarComentario,
      cleanPrice: cleanPrice,
     refreshStockLocal 
      }), [
      items, tipoOrden, total, metodoPago, propina, montoManual, eliminarLineaConStock, refreshStockLocal
      ]);

  return (
    <CartContext.Provider value={contextValue}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);