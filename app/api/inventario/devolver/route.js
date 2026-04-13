import { NextResponse } from 'next/server';
import { sanityClientServer } from '@/lib/sanity';

export const dynamic = 'force-dynamic';

export async function POST(request) {
    try {
        const { items } = await request.json();

        if (!items || !Array.isArray(items)) {
            return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
        }

        // 🛡️ BISTURÍ: Usamos una transacción para procesar todo en un solo viaje a Sanity
        let transaction = sanityClientServer.transaction();
        let hayCambios = false;

        for (const item of items) {
            // 1. Identificar el ID de forma estricta
            // Buscamos directamente 'insumoId'. El frontend ya se encarga de enviarlo plano.
            const insumoId = item.insumoId;
            
            if (!insumoId || insumoId === 'undefined') {
                console.warn("⚠️ Intento de devolución ignorado: ID de insumo no válido.");
                continue; 
            }

            // 2. Cálculo SEGURO (Suma Simple)
            // 🚀 BISTURÍ: Eliminamos la lógica de multiplicación. 
            // El CartContext de Deli Arepa ya calculó Plato + Toppings.
            // Si el frontend dice que devuelva 1.5 unidades, sumamos 1.5 unidades.
            const totalARecuperar = Number(item.cantidad) || 0;

            if (totalARecuperar > 0) {
                hayCambios = true;
                transaction = transaction.patch(insumoId, {
                    setIfMissing: { stockActual: 0 },
                    inc: { stockActual: totalARecuperar }
                });
                console.log(`📝 Devolviendo a stock: ${insumoId} +${totalARecuperar}`);
            }
        }

        if (hayCambios) {
            // 3. Commit atómico
            await transaction.commit();
            console.log("✅ Sanity: Devolución de stock (Platos + Toppings) procesada con éxito.");
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('❌ ERROR_DEVOLVER_ROUTE:', error.message);
        return NextResponse.json({ 
            error: 'Error interno en la devolución de inventario',
            details: error.message 
        }, { status: 500 });
    }
}