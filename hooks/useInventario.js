import useSWR from 'swr';
import { useCart } from '@/app/context/CartContext';

const fetcher = async (url) => {
    // 🚀 TIMESTAMP: Evita que el navegador te devuelva datos viejos guardados en el historial.
    const res = await fetch(`${url}?t=${Date.now()}`); 
    if (!res.ok) throw new Error('Error al cargar datos');
    return res.json();
};

export function useInventario() {
    const { refreshStockLocal } = useCart();
    
    const { data, error, mutate, isLoading } = useSWR('/api/inventario/list', fetcher, {
        refreshInterval: 30000,      // ✅ 30 segundos: Ahorro de cuota en Sanity.
        revalidateOnFocus: true,     // ✅ Si el mesero cambia de app y vuelve, refresca.
        revalidateOnMount: true,     
        dedupingInterval: 0,         // ⚡ IMPORTANTE: Permite refrescos instantáneos.
        revalidateIfStale: true      // ⚡ CAMBIO: Muestra lo que hay mientras trae lo nuevo para que no parpadee.
    });

    const cargarStock = async (insumoId, cantidad) => {
        try {
            const res = await fetch('/api/inventario/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ insumoId, cantidadASumar: Number(cantidad) })
            });
            
            if (res.ok) {
                // 1. Limpiamos el caché del carrito (el que bloquea los botones del menú)
                if (refreshStockLocal) refreshStockLocal(); 
                
                // 2. ⚡ REVALIDACIÓN TOTAL:
                // Le decimos a SWR: "Olvida tu caché de inventario, ve a Sanity YA MISMO".
                await mutate(); 
                
                return true;
            }
            return false;
        } catch (err) {
            console.error("🔥 Error actualizando stock:", err);
            return false;
        }
    };

    return { 
        insumos: data || [], 
        cargarStock,
        cargando: isLoading,
        mutate, 
        error
    };
}