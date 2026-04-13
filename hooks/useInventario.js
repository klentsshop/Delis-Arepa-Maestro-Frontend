import useSWR from 'swr';
import { useCart } from '@/app/context/CartContext';

const fetcher = async (url) => {
    const res = await fetch(`${url}?t=${Date.now()}`); 
    if (!res.ok) throw new Error('Error al cargar datos');
    return res.json();
};

export function useInventario() {
    const { refreshStockLocal } = useCart();
    
    const { data, error, mutate, isLoading } = useSWR('/api/inventario/list', fetcher, {
        refreshInterval: 30000,      // ✅ 30 segundos: Ahorro de cuota.
        revalidateOnFocus: true,     // ✅ Refresca al volver a la pestaña.
        revalidateOnMount: true,     
        dedupingInterval: 0,         // ⚡ Permite refrescos instantáneos.
        revalidateIfStale: true      // ⚡ Sin parpadeos.
    });

    const cargarStock = async (insumoId, cantidad) => {
        const monto = Number(cantidad);

        try {
            // 🚀 1. ACTUALIZACIÓN OPTIMISTA
            // Sumamos localmente para que el usuario vea el resultado YA.
            mutate((actualData) => {
                if (!actualData) return [];
                return actualData.map(ins => 
                    ins._id === insumoId 
                        ? { ...ins, stockActual: (Number(ins.stockActual) || 0) + monto } 
                        : ins
                );
            }, false); 

            // 2. PETICIÓN AL SERVIDOR
            const res = await fetch('/api/inventario/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ insumoId, cantidadASumar: monto })
            });
            
            if (res.ok) {
                // 3. LIMPIEZA DE CACHÉ DEL CARRITO
                if (refreshStockLocal) refreshStockLocal(); 
                
                // 4. REVALIDACIÓN FINAL
                // Trae la "verdad" de Sanity para asegurar que el servidor y el cliente coincidan.
                await mutate(); 
                return true;
            } else {
                // Si falla el servidor, revertimos el cambio visual
                mutate();
                return false;
            }
        } catch (err) {
            console.error("🔥 Error actualizando stock:", err);
            // Revertimos en caso de error de red
            mutate();
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