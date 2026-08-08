export default async function handler(req, res) {
    // req.url puede ser relativa (runtime Node) o absoluta (Web Request);
    // la base se ignora cuando req.url ya es absoluta.
    const url = new URL(
        req.url,
        `http://${req.headers?.host ?? "localhost"}`
    );

    const buscar = url.searchParams.get("buscar");
    const entidad = url.searchParams.get("entidad") || "00";
    const municipio = url.searchParams.get("municipio");

    // Tope de seguridad: 5 páginas de 1000 = 5 000 registros por consulta.
    const rowsPerPage = 1000;
    const maxPaginas = 5;

    if (!buscar && !municipio) {
        return res.status(400).json({
            error: "Falta el parámetro buscar o municipio"
        });
    }

    if (municipio && !/^\d{5}$/.test(municipio)) {
        return res.status(400).json({
            error: "municipio debe ser una clave de 5 dígitos (ej. 18004)"
        });
    }

    const token = process.env.INEGI_TOKEN;

    if (!token) {
        return res.status(500).json({
            error: "INEGI_TOKEN no configurado"
        });
    }

    // Primer término si vienen varios separados por coma; null si no hay búsqueda.
    const termino = buscar ? buscar.split(",")[0].trim() : null;

    const construirUrl = (start, end) => {
        if (municipio) {
            // BuscarAreaAct: entidad (2 dígitos) + municipio (3 dígitos);
            // los demás niveles geográficos y de actividad van en 0 ("todos").
            const entidadMunicipio = municipio.slice(0, 2);
            const claveMunicipio = municipio.slice(2, 5);
            const nombre = termino ? encodeURIComponent(termino) : "0";

            return (
                `https://www.inegi.org.mx/app/api/denue/v1/consulta/` +
                `BuscarAreaAct/${entidadMunicipio}/${claveMunicipio}` +
                `/0/0/0/0/0/0/0/${nombre}/${start}/${end}/0/${token}`
            );
        }

        return (
            `https://www.inegi.org.mx/app/api/denue/v1/consulta/` +
            `buscarEntidad/${encodeURIComponent(termino)}/${entidad}/${start}/${end}/${token}`
        );
    };

    try {
        // Recorre las páginas del DENUE hasta agotar los resultados.
        const negocios = [];
        let truncado = false;

        for (let pagina = 0; pagina < maxPaginas; pagina++) {
            const start = pagina * rowsPerPage + 1;
            const end = (pagina + 1) * rowsPerPage;

            const response = await fetch(construirUrl(start, end), {
                // Evita que la petición quede colgada si el DENUE tarda demasiado.
                signal: AbortSignal.timeout(30000)
            });

            if (!response.ok) {
                return res.status(response.status).json({
                    error: "INEGI respondió con un error",
                    status: response.status
                });
            }

            const data = await response.json();

            negocios.push(
                ...data.map(negocio => ({
                    id: negocio.Id,
                    nombre: negocio.Nombre,
                    razon_social: negocio.Razon_social,
                    clase_actividad: negocio.Clase_actividad,
                    estrato: negocio.Estrato,
                    tipo_vialidad: negocio.Tipo_vialidad,
                    calle: negocio.Calle,
                    num_exterior: negocio.Num_Exterior,
                    num_interior: negocio.Num_Interior,
                    colonia: negocio.Colonia,
                    cp: negocio.CP,
                    ubicacion:
                        String(negocio.Ubicacion || "").toUpperCase(),
                    telefono: negocio.Telefono,
                    correo: negocio.Correo_e,
                    sitio_internet: negocio.Sitio_internet,
                    tipo: negocio.Tipo,
                    longitud: negocio.Longitud,
                    latitud: negocio.Latitud,
                    tipo_corredor_industrial:
                        negocio.tipo_corredor_industrial,
                    nom_corredor_industrial:
                        negocio.nom_corredor_industrial,
                    numero_local: negocio.numero_local
                }))
            );

            // Página parcial: es la última.
            if (data.length < rowsPerPage) {
                break;
            }

            truncado = data.length === rowsPerPage;
        }

        return res.status(200).json({
            count: negocios.length,
            truncado,
            data: negocios
        });

    } catch (error) {
        console.error(error);

        const esTimeout = error && error.name === "TimeoutError";

        return res.status(esTimeout ? 504 : 500).json({
            error: esTimeout
                ? "El DENUE tardó demasiado en responder"
                : "Error consultando DENUE"
        });
    }
}
