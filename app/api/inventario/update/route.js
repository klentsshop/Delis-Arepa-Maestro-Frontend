// 1. IMPORTACIÓN CRÍTICA: Usamos el cliente con permisos de escritura (TOKEN)
import { sanityClientServer as client } from '@/lib/sanity'; 
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request) {
    try {
        const body = await request.json();
        const { insumoId, cantidadASumar } = body;

        // 2. Validación de seguridad básica
        if (!insumoId || cantidadASumar === undefined) {
            return NextResponse.json({ error: "Faltan datos (ID o Cantidad)" }, { status: 400 });
        }

        // 3. Normalización de datos
        const monto = Number(cantidadASumar);

        // 🛡️ BISTURÍ: Obtenemos el stock actual directamente de la fuente de verdad (Sanity)
        // Esto asegura que sumamos sobre el valor real del servidor, no sobre lo que cree el cliente.
        const actual = await client.fetch(`*[_id == $id][0].stockActual`, { id: insumoId });
        
        // Calculamos el nuevo valor final
        const nuevoValorCalculado = (Number(actual) || 0) + monto;

        // 🚀 OPERACIÓN MAESTRA BLINDADA
        // Usamos .set() en lugar de .inc() para evitar que peticiones duplicadas
        // sigan sumando erróneamente.
        const result = await client
            .patch(insumoId)
            .setIfMissing({ stockActual: 0 }) 
            .set({ stockActual: nuevoValorCalculado }) // 👈 CORRECCIÓN: Establece el valor exacto calculado
            .commit();

        console.log(`✅ Sanity: ${insumoId} actualizado. Nuevo stock: ${result.stockActual}`);

        return NextResponse.json({ 
            success: true, 
            nuevoStock: result.stockActual 
        });

    } catch (error) {
        console.error("🔥 Error real de Sanity en servidor:", error.message);
        return NextResponse.json({ 
            error: "Error al actualizar el inventario",
            details: error.message 
        }, { status: 500 });
    }
}