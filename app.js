import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getFirestore, collection, doc, setDoc, onSnapshot, 
    deleteDoc, getDoc, getDocs, query, writeBatch 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";


const firebaseConfig = {
    apiKey: "AIzaSyCqHy9ny-hi_92Rem_Y7QQlhGVCM_7yEcQ",
    authDomain: "asistencia-809aa.firebaseapp.com",
    projectId: "asistencia-809aa",
    storageBucket: "asistencia-809aa.firebasestorage.app",
    messagingSenderId: "1084715358166",
    appId: "1:1084715358166:web:a4ba59e2286ab4be54b677"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- 1. GUARDAR / EDITAR ALUMNO ---
const registroForm = document.getElementById('registroForm');
if(registroForm) {
    registroForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const dni = document.getElementById('dni').value;
        const datos = {
            dni: dni,
            nombres: document.getElementById('nombres').value,
            grado: document.getElementById('grado').value,
            seccion: document.getElementById('seccion').value,
            telefono: document.getElementById('telefono').value
        };
        try {
            await setDoc(doc(db, "alumnos", dni), datos);
            alert("Alumno guardado con éxito");
            window.generarSoloQR(dni);
            registroForm.reset();
        } catch (error) { alert("Error al guardar: " + error.message); }
    });
}

window.cambiarFechaAsistencia = (nuevaFecha) => {
    // nuevaFecha viene en formato YYYY-MM-DD del input
    console.log("Cambiando vista a:", nuevaFecha);
    
    // Llamamos a la función que escucha la asistencia pero con la fecha seleccionada
    iniciarControlAsistencia(nuevaFecha);
};


// --- 2. GENERAR QR ---
window.generarSoloQR = async (dni) => {
    const qrDiv = document.getElementById("qrcode");
    const container = document.getElementById('qrContainer');
    
    const txtNombres = document.getElementById('soloNombresMostrado');
    const txtApellidos = document.getElementById('soloApellidosMostrado');
    const txtDni = document.getElementById('dniMostrado');
    const txtGradoSec = document.getElementById('gradoSeccionMostrado');
    
    qrDiv.innerHTML = "Generando..."; 

    try {
        const docRef = doc(db, "alumnos", dni);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const datos = docSnap.data();
            qrDiv.innerHTML = "";
            
            // Generar QR con tamaño estándar para carnet
            new QRCode(qrDiv, { text: dni, width: 160, height: 160 });

            // Lógica de separación de nombres
            const palabras = (datos.nombres || "").trim().split(' ');
            let nombresArr = "";
            let apellidosArr = "";

            if (palabras.length >= 3) {
                nombresArr = palabras.slice(0, 2).join(' ');
                apellidosArr = palabras.slice(2).join(' ');
            } else {
                nombresArr = palabras[0] || "";
                apellidosArr = palabras.slice(1).join(' ') || "";
            }

            // CORRECCIÓN: Usar las variables correctas (nombresArr y apellidosArr)
            txtNombres.innerText = nombresArr.toUpperCase();
            txtApellidos.innerText = apellidosArr.toUpperCase();
            
            // Datos escolares
            txtDni.innerText = "DNI: " + datos.dni;
            txtGradoSec.innerText = `${datos.grado || '-'}° "${datos.seccion || '-'}"`.toUpperCase();

            // Ajuste dinámico de tamaño para evitar desbordamientos
            setTimeout(() => {
                if(typeof window.ajustarTextoDinámico === 'function') {
                    window.ajustarTextoDinámico('soloNombresMostrado');
                    window.ajustarTextoDinámico('soloApellidosMostrado');
                }
            }, 100);

            // Interfaz y navegación
            window.mostrarSeccion('registro'); 
            container.classList.remove('hidden');
            window.scrollTo({ top: 0, behavior: 'smooth' });
            
        } else {
            alert("No se encontró el alumno en la base de datos.");
        }
    } catch (error) {
        console.error("Error al generar QR:", error);
    }
};

window.cerrarDia = async () => {
    const hoy = new Date().toLocaleDateString('en-CA');
    if (!confirm("¿Finalizar día y enviar notificaciones de FALTA a los padres?")) return;

    try {
        const batch = writeBatch(db); // Ahora sí funcionará con la importación correcta
        const snapAlumnos = await getDocs(collection(db, "alumnos"));
        const snapAsistencia = await getDocs(collection(db, "asistencia", hoy, "registros"));
        
        const asistieronDni = new Set();
        snapAsistencia.forEach(docSnap => asistieronDni.add(docSnap.id));

        let contFaltas = 0;

        for (const docAlumno of snapAlumnos.docs) {
            const dni = docAlumno.id;
            const datosAlu = docAlumno.data();

            if (!asistieronDni.has(dni)) {
                contFaltas++;
                
                // 1. Registro en Firebase
                const refFalta = doc(db, "asistencia", hoy, "registros", dni);
                batch.set(refFalta, {
                    nombres: datosAlu.nombres,
                    hora: "--:--:--",
                    estado: "Faltó",
                    fecha: hoy,
                    grado: datosAlu.grado || "?", 
            seccion: datosAlu.seccion || "?"
                }, { merge: true });

                // 2. Envío de Notificación (Agregamos await para asegurar el envío)
                if (datosAlu.telefono) {
                    const mensajeFalta = `*INASISTENCIA*\n\nEstimado apoderado, se le informa que el estudiante *${datosAlu.nombres.toUpperCase()}* no ha registrado su asistencia el día de hoy (${hoy}).\n\n_I.E. Horacio Zeballos Gámez_`;
                    await window.enviarNotificacionUltraMsg(datosAlu.telefono, datosAlu.nombres, "Faltó", mensajeFalta);
                }
            }
        }

        await batch.commit(); 
        alert(`Éxito: Se registraron ${contFaltas} faltas.`);
        
    } catch (error) {
        console.error("Error en cerrarDia:", error);
        alert("Error: " + error.message);
    }
};

// --- 3. ASISTENCIA EN TIEMPO REAL ---
const iniciarControlAsistencia = (fechaManual = null) => {
    const hoy = fechaManual || new Date().toLocaleDateString('en-CA');
    const contenedorAsis = document.getElementById('asistenciaHoy');
    if (!contenedorAsis) return;

    onSnapshot(collection(db, "asistencia", hoy, "registros"), (snapshot) => {
        contenedorAsis.innerHTML = "";

        if (snapshot.empty) {
            contenedorAsis.innerHTML = `<div class="p-10 text-center text-slate-400 italic border-2 border-dashed rounded-xl">
                No hay ingresos registrados para esta fecha (${hoy})...
            </div>`;
            return;
        }

        // ✅ SIN peticiones extra — lee grado/sección del mismo documento
        const registros = snapshot.docs.map(docSnap => {
            const d = docSnap.data();
            return {
                ...d,
                dni: docSnap.id,
                aula: `${d.grado || '?'}° "${d.seccion || '?'}"`.toUpperCase()
            };
        });

        // Agrupar por Aula
        const grupos = registros.reduce((acc, curr) => {
            if (!acc[curr.aula]) acc[curr.aula] = [];
            acc[curr.aula].push(curr);
            return acc;
        }, {});

        // Renderizar bloques por sección
        Object.keys(grupos).sort().forEach(aula => {
            const sectionDiv = document.createElement('div');
            sectionDiv.className = "mb-8 overflow-hidden rounded-xl border border-slate-200 shadow-sm";

            sectionDiv.innerHTML = `
                <div class="bg-slate-50 border-b border-slate-200 px-4 py-2 flex justify-between items-center">
                    <h3 class="font-black text-green-800 text-sm">📍 SECCIÓN: ${aula}</h3>
                    <span class="bg-green-600 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">
                        ${grupos[aula].length} PRESENTES
                    </span>
                </div>
                <table class="w-full text-left border-collapse">
                    <tbody class="bg-white">
                        ${grupos[aula].map(reg => {
                            const color = reg.estado === "Puntual" ? "bg-green-100 text-green-700" :
                                          reg.estado === "Tardanza" ? "bg-yellow-100 text-yellow-700" :
                                          reg.estado?.includes("Justificada") ? "bg-blue-100 text-blue-700" : 
                                          "bg-red-100 text-red-700";
                            return `
                                <tr class="border-b last:border-0 hover:bg-slate-50 transition">
                                    <td class="p-3 font-bold text-green-700 w-20 text-sm">${reg.hora || '--:--'}</td>
                                    <td class="p-3">
                                        <div class="font-bold text-slate-700 text-sm">${reg.nombres}</div>
                                        <div class="text-[9px] text-slate-400 font-bold uppercase">DNI: ${reg.dni}</div>
                                    </td>
                                    <td class="p-3 w-32">
                                        <span class="px-2 py-0.5 rounded-full text-[9px] font-black ${color}">
                                            ${reg.estado?.toUpperCase()}
                                        </span>
                                    </td>
                                    <td class="p-3 text-right w-20">
                                        <button onclick="window.justificarFalta('${reg.dni}', '${reg.nombres}')"
                                                class="text-[10px] font-black text-blue-600 hover:text-blue-800 uppercase tracking-tighter">
                                            EDITAR
                                        </button>
                                    </td>
                                </tr>`;
                        }).join('')}
                    </tbody>
                </table>`;
            contenedorAsis.appendChild(sectionDiv);
        });
    });
};

// Función auxiliar para dar un respiro a la API
const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

window.escanearYRegistrarMasivo = async () => {
    const fileInput = document.getElementById('fotoMasiva');
    const log = document.getElementById('logRegistro');
    const btn = document.getElementById('btnMasivo');
    
    const gradoDefault = document.getElementById('grado').value.trim();
    const seccionDefault = document.getElementById('seccion').value.trim().toUpperCase();

    const archivo = fileInput.files[0];
    if (!archivo) return alert("Selecciona un archivo Excel.");

    log.classList.remove('hidden');
    log.innerHTML = `🚀 Iniciando procesamiento masivo institucional...<br>`;
    btn.disabled = true;

    try {
        let estudiantesParaProcesar = [];

        if (archivo.name.endsWith('.xlsx') || archivo.name.endsWith('.xls')) {
            const data = await archivo.arrayBuffer();
            const libro = XLSX.read(data, { type: 'array' });
            const hoja = libro.Sheets[libro.SheetNames[0]];
            const filasRaw = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: "" });
            
            log.innerHTML += "📊 Analizando estructura de datos escolar...<br>";

            estudiantesParaProcesar = filasRaw.map(fila => {
                const valores = fila.map(v => String(v).trim());
                return {
                    dni: valores.find(v => /^\d{8}$/.test(v)),
                    nombreExcel: valores.find(v => v.length > 10 && !/^\d+$/.test(v)),
                    telefono: valores.find(v => /^\d{9}$/.test(v)),
                    grado: valores.find(v => /^[1-5]$/.test(v)) || gradoDefault,
                    seccion: valores.find(v => /^[A-Fa-f]$/.test(v))?.toUpperCase() || seccionDefault
                };
            }).filter(est => est.dni); 
        } else {
            return alert("Por favor use archivos Excel (.xlsx o .xls).");
        }

        const total = estudiantesParaProcesar.length;
        log.innerHTML += `✅ <b>Total identificado: ${total} alumnos.</b><hr class='border-slate-700 my-2'>`;

        // USAMOS UN BUCLE CON ÍNDICE PARA EL CONTEO
        for (let i = 0; i < total; i++) {
            const est = estudiantesParaProcesar[i];
            const numActual = i + 1; // El número de alumno actual

            // Mostramos el conteo en el log: [1 de 50]
            log.innerHTML += `<span class="text-blue-400">[${numActual}/${total}]</span> 🔍 ${est.dni}... `;
            
            let nombreFinal = est.nombreExcel || "PENDIENTE";

            try {
                // Delay para no saturar la API (0.6 seg)
                await new Promise(r => setTimeout(r, 600)); 
                const apiKey = "sk_14665.dSb1iTSCRxookfSigq90nJUIs4udOhuC"; 
                const response = await fetch(`https://api.decolecta.com/v1/dni/${est.dni}`, {
                    method: "GET",
                    headers: { "Authorization": `Bearer ${apiKey}`, "X-Requested-With": "XMLHttpRequest" }
                });
                const res = await response.json();
                if (res.success && res.data) {
                    nombreFinal = res.data.nombre_completo || `${res.data.nombres} ${res.data.apellido_paterno} ${res.data.apellido_materno}`;
                }
            } catch (e) { console.warn("Usando nombre local para:", est.dni); }

            // GUARDADO EN FIREBASE
            await setDoc(doc(db, "alumnos", String(est.dni)), {
                dni: String(est.dni),
                nombres: nombreFinal.toUpperCase(),
                grado: String(est.grado),
                seccion: String(est.seccion),
                telefono: String(est.telefono || ""),
                fechaRegistro: new Date().toLocaleDateString()
            }, { merge: true });

            log.innerHTML += `<span class="text-green-400">OK ✅</span><br>`;
            
            // Auto-scroll para seguir el progreso
            log.scrollTop = log.scrollHeight;
        }

        alert(`✅ Éxito. Se procesaron los ${total} alumnos.`);
        if(typeof window.cargarBloques === 'function') await window.cargarBloques();

    } catch (e) {
        log.innerHTML += `<br><span class="text-red-500">❌ Error: ${e.message}</span>`;
    } finally {
        btn.disabled = false;
    }
};

window.consultarDNI = async () => {
    const dni = document.getElementById('dni').value;
    const inputNombre = document.getElementById('nombres');
    const btn = document.getElementById('btnBuscarDNI');

    if (dni.length !== 8) return alert("DNI inválido");

    btn.disabled = true;
    btn.innerHTML = "⏳";
    try {
        const token = "75881d0ad45fc822d207432641eb46af3a40a7aaadb9b7601346298f00939f8a"; 

        const response = await fetch("https://apiperu.dev/api/dni", {
            method: "POST",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ dni: dni })
        });

        const res = await response.json();

        if (res.success && res.data) {
            // Extraemos los campos por separado para darles el orden: NOMBRE APELLIDOS
            const nombres = res.data.nombres;
            const apePaterno = res.data.apellido_paterno;
            const apeMaterno = res.data.apellido_materno;

            // Concatenamos en el orden deseado y convertimos a Mayúsculas
            inputNombre.value = `${nombres} ${apePaterno} ${apeMaterno}`.toUpperCase();
            
        } else {
            throw new Error("No encontrado");
        }

    } catch (error) {
        console.error("Error:", error);
        alert("Servicio temporalmente fuera de línea. Ingrese el nombre manualmente.");
        inputNombre.disabled = false;
        inputNombre.focus();
    } finally {
        btn.disabled = false;
        btn.innerHTML = "🔍";
    }
};

window.imprimirCarnet = async (dni) => {
    try {
        const docAlu = await getDoc(doc(db, "alumnos", dni));
        if (!docAlu.exists()) return alert("Error al recuperar datos");
        
        const a = docAlu.data();
        const palabras = (a.nombres || "").trim().split(' ');
        let nom = "", ape = "";

        // Lógica de separación de nombres/apellidos institucional
        if (palabras.length >= 3) {
            nom = palabras.slice(2).join(' '); // Nombres al final
            ape = palabras.slice(0, 2).join(' '); // Apellidos al inicio
        } else {
            ape = palabras[0] || "";
            nom = palabras.slice(1).join(' ') || "";
        }

        const ventana = window.open('', '', 'height=600,width=800');
        ventana.document.write(`
            <html>
            <head>
                <title>Carnet - ${a.nombres}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700;900&display=swap');
                    body { font-family: 'Roboto', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f3f4f6; }
                    
                    .carnet { 
                        width: 8.6cm; height: 5.4cm; 
                        background: white; border-radius: 15px; position: relative; overflow: hidden;
                        box-shadow: 0 10px 25px rgba(0,0,0,0.1); border: 1px solid #ccc;
                    }

                    /* ENCABEZADO VERDE SÓLIDO */
                    .cabecera { 
                        background: #15803D; color: white; padding: 10px; text-align: center; 
                        font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px;
                    }

                    /* CUERPO DEL CARNET */
                    .contenido { display: flex; padding: 15px; align-items: flex-start; justify-content: space-between; }

                    .logo-seccion { width: 60px; text-align: center; }
                    .logo-img { width: 55px; height: auto; margin-top: 5px; }

                    .info-estudiante { flex-grow: 1; padding-left: 15px; margin-top: 5px; }
                    .label-est { font-size: 8px; color: #15803D; font-weight: bold; margin-bottom: 2px; }
                    .apellido-val { font-size: 15px; color: #111; font-weight: 900; line-height: 1; text-transform: uppercase; }
                    .nombre-val { font-size: 12px; color: #444; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; }
                    
                    .datos-linea { font-size: 11px; font-weight: 900; color: #15803D; margin-top: 4px; }
                    .datos-linea span { color: #333; margin-left: 3px; }

                    /* QR POSICIONADO A LA DERECHA */
                    .qr-box { 
                        width: 85px; height: 85px; background: white; 
                        padding: 5px; border: 1.5px solid #eee; border-radius: 10px;
                        display: flex; justify-content: center; align-items: center;
                    }

                    /* PIE DE PÁGINA */
                    .footer { 
                        position: absolute; bottom: 0; width: 100%; background: #f0fdf4; 
                        text-align: center; font-size: 9px; color: #15803D; font-weight: 900; 
                        padding: 6px 0; border-top: 1px solid #dcfce7;
                    }

                    @media print { 
                        body { background: none; } 
                        .carnet { box-shadow: none; -webkit-print-color-adjust: exact; } 
                    }
                </style>
            </head>
            <body>
                <div class="carnet">
                    <div class="cabecera">I.E. HORACIO ZEBALLOS GÁMEZ - MALINGAS</div>
                    
                    <div class="contenido">
                        <div class="logo-seccion">
                            <img src="logo_colegio.jpeg" class="logo-img">
                        </div>

                        <div class="info-estudiante">
                            <div class="label-est">ESTUDIANTE:</div>
                            <div class="apellido-val">${ape}</div>
                            <div class="nombre-val">${nom}</div>
                            
                            <div class="datos-linea">DNI: <span>${a.dni}</span></div>
                            <div class="datos-linea">AULA: <span>${a.grado || '-'}° "${a.seccion || '-'}"</span></div>
                        </div>

                        <div class="qr-box">
                            <div id="qr"></div>
                        </div>
                    </div>

                    <div class="footer">DISCIPLINA • LEALTAD • HONRADEZ</div>
                </div>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
                <script>
                    new QRCode(document.getElementById("qr"), { 
                        text: "${a.dni}", 
                        width: 80, 
                        height: 80,
                        correctLevel : QRCode.CorrectLevel.H
                    });
                    setTimeout(() => { window.print(); window.close(); }, 800);
                </script>
            </body>
            </html>
        `);
        ventana.document.close();
        
    } catch (e) {
        console.error(e);
        alert("Error al generar impresión del carnet");
    }
};

// --- 4. EXPORTACIÓN PDF ---
window.generarReportePDF = async () => {
    const { jsPDF } = window.jspdf;
    const docPDF = new jsPDF();
    const hoyId = new Date().toLocaleDateString('en-CA');
    const snap = await getDocs(collection(db, "asistencia", hoyId, "registros"));
    
    if(snap.empty) return alert("No hay datos para exportar hoy.");

    console.log("Generando PDF segmentado por aulas...");

    // 1. Agrupar datos por Grado/Sección primero
    const datosPorGrado = {};
    for (const d of snap.docs) {
        const dataAsis = d.data();
        let gradoSec = "N/A";

        const docAlu = await getDoc(doc(db, "alumnos", d.id));
        if (docAlu.exists()) {
            const alu = docAlu.data();
            gradoSec = `${alu.grado}° "${alu.seccion}"`.toUpperCase();
        }

        if (!datosPorGrado[gradoSec]) datosPorGrado[gradoSec] = [];
        datosPorGrado[gradoSec].push([
            dataAsis.hora || '--:--', 
            d.id, 
            dataAsis.nombres.toUpperCase(), 
            gradoSec, 
            dataAsis.estado.toUpperCase()
        ]);
    }

    // 2. Generar hojas en el PDF
    const grados = Object.keys(datosPorGrado).sort();
    
    grados.forEach((grado, index) => {
        // Si no es la primera hoja, añadimos una nueva página
        if (index > 0) docPDF.addPage();

        // Encabezado Institucional
        docPDF.setTextColor(21, 128, 61); // Verde Malingas
        docPDF.setFontSize(16);
        docPDF.setFont("helvetica", "bold");
        docPDF.text("I.E. HORACIO ZEBALLOS GÁMEZ", 14, 20);
        
        docPDF.setFontSize(10);
        docPDF.setTextColor(100);
        docPDF.text(`MALINGAS - TAMBOGRANDE | REPORTE DE ASISTENCIA`, 14, 25);
        
        docPDF.setDrawColor(21, 128, 61);
        docPDF.line(14, 27, 196, 27); // Línea decorativa verde

        docPDF.setTextColor(0);
        docPDF.setFontSize(12);
        docPDF.text(`FECHA: ${hoyId}`, 14, 35);
        docPDF.text(`GRADO Y SECCIÓN: ${grado}`, 14, 42);

        // Tabla de alumnos para este grado específico
        docPDF.autoTable({ 
            startY: 48, 
            head: [['HORA', 'DNI', 'ESTUDIANTE', 'G/S', 'ESTADO']], 
            body: datosPorGrado[grado], 
            headStyles: { 
                fillColor: [21, 128, 61], // Fondo Verde
                textColor: [255, 255, 255], // Texto Blanco
                fontStyle: 'bold'
            },
            styles: { 
                fontSize: 9,
                cellPadding: 3
            },
            alternateRowStyles: {
                fillColor: [240, 253, 244] // Verde muy claro para filas alternas
            }
        });

        // Pie de página con número de página
        const pageCount = docPDF.internal.getNumberOfPages();
        docPDF.setFontSize(8);
        docPDF.setTextColor(150);
        docPDF.text(`Página ${pageCount}`, 196, 285, { align: 'right' });
    });

    docPDF.save(`Reporte_Asistencia_HZG_${hoyId}.pdf`);
};

// --- 5. EXPORTACIÓN EXCEL ---
window.generarReporteExcel = async () => {
    const hoyId = new Date().toLocaleDateString('en-CA');
    const snap = await getDocs(collection(db, "asistencia", hoyId, "registros"));
    
    if (snap.empty) return alert("No hay datos para exportar hoy.");

    const datosPorGrado = {};

    // 1. Agrupación de datos por Grado/Sección
    for (const d of snap.docs) {
        const data = d.data();
        let gradoSec = "N/A";
        const docAlu = await getDoc(doc(db, "alumnos", d.id));
        if (docAlu.exists()) {
            const alu = docAlu.data();
            gradoSec = `${alu.grado}${alu.seccion}`.toUpperCase();
        }
        if (!datosPorGrado[gradoSec]) datosPorGrado[gradoSec] = [];
        datosPorGrado[gradoSec].push({
            "HORA": data.hora || '--:--',
            "DNI": d.id,
            "ESTUDIANTE": data.nombres.toUpperCase(),
            "GRADO/SEC": gradoSec,
            "ESTADO": data.estado.toUpperCase()
        });
    }

    // 2. Crear el Libro de Trabajo (Workbook)
    const wb = XLSX.utils.book_new();

    // 3. Crear una hoja por cada grupo
    Object.keys(datosPorGrado).sort().forEach(grado => {
        // 1. Convertimos los datos a hoja de cálculo
        const ws = XLSX.utils.json_to_sheet(datosPorGrado[grado]);

        // 2. --- AQUÍ VA EL DISEÑO ---
        // Definimos el rango de la hoja (ej: A1:E10)
        const range = XLSX.utils.decode_range(ws['!ref']);

        // Recorremos las celdas de la primera fila (encabezados) para darles estilo
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const address = XLSX.utils.encode_cell({ r: 0, c: C }); // Fila 0, Columna C
            if (!ws[address]) continue;

            // IMPORTANTE: Para que estos estilos funcionen en .xlsx libre, 
            // a veces es necesario usar una extensión de la librería o forzar el formato XML.
            ws[address].s = {
                fill: { fgColor: { rgb: "15803D" } }, // Verde institucional
                font: { color: { rgb: "FFFFFF" }, bold: true }, // Blanco Negrita
                alignment: { horizontal: "center" }
            };
        }

        // Ajuste de anchos de columna (esto sí funciona siempre)
        ws['!cols'] = [
            { wch: 12 }, { wch: 15 }, { wch: 45 }, { wch: 12 }, { wch: 15 }
        ];

        XLSX.utils.book_append_sheet(wb, ws, `GRADO ${grado}`);
    });

    // 4. Exportar como archivo .xlsx (Formato moderno, no dañado)
    XLSX.writeFile(wb, `Reporte_Asistencia_HZG_${hoyId}.xlsx`);
};

const enviarNotificacionUltraMsg = async (telefono, nombre, estado) => {
    const url = "https://api.ultramsg.com/instance169160/messages/chat";
    const token = "bkd2pujvtq9icz2w";
    const mensaje = `*I.E. Horacio Zeballos Zeballos*\n\nHola, se informa que el estudiante *${nombre}* registró su ingreso como: *${estado.toUpperCase()}*.\n\n_Malingas: Disciplina, Lealtad, Honradez._`;

    const params = new URLSearchParams();
    params.append('token', token);
    params.append('to', `+51${telefono}`); // Asegúrate de que el teléfono tenga 9 dígitos
    params.append('body', mensaje);

    try {
        await fetch(url, {
            method: 'POST',
            body: params
        });
        console.log("Notificación enviada a:", nombre);
    } catch (error) {
        console.error("Error al enviar UltraMsg:", error);
    }
};

// --- 6. GESTIÓN DE BLOQUES Y VISTA DE ALUMNOS ---
window.cargarBloques = async () => {
    const contenedorPrincipal = document.getElementById('contenedorBloques');
    const vistaTabla = document.getElementById('vistaTablaAlumnos');
    const btnVolver = document.getElementById('btnVolverBloques');
    const titulo = document.getElementById('tituloLista');
    // Referencia al botón de impresión masiva
    const btnImprimirTodo = document.getElementById('btnImprimirTodoGrado');

    contenedorPrincipal.classList.remove('hidden');
    vistaTabla.classList.add('hidden');
    btnVolver.classList.add('hidden');
    
    // OCULTAR botón de impresión masiva en la vista general
    if (btnImprimirTodo) btnImprimirTodo.classList.add('hidden');

    titulo.innerText = "Grados y Secciones";
    
    contenedorPrincipal.innerHTML = "<p class='col-span-full text-center text-slate-500'>Cargando grados...</p>";

    try {
        const snap = await getDocs(collection(db, "alumnos"));
        if (snap.empty) {
            contenedorPrincipal.innerHTML = "<p class='col-span-full text-center text-red-500 font-bold'>No hay alumnos registrados.</p>";
            return;
        }

        const gradosAgrupados = {};
        snap.forEach(doc => {
            const data = doc.data();
            if (data.grado && data.seccion) {
                const gradoNum = data.grado;
                if (!gradosAgrupados[gradoNum]) gradosAgrupados[gradoNum] = new Set();
                gradosAgrupados[gradoNum].add(`${data.grado}${data.seccion}`.toUpperCase());
            }
        });

        contenedorPrincipal.innerHTML = ""; 
        contenedorPrincipal.className = "flex flex-col gap-8"; 

        Object.keys(gradosAgrupados).sort().forEach(gradoNum => {
            const filaDiv = document.createElement('div');
            filaDiv.className = "space-y-3";
            filaDiv.innerHTML = `<h3 class="text-malingas-green font-black text-sm border-l-4 border-malingas-green pl-2">GRADO: ${gradoNum}°</h3>`;
            
            const gridFila = document.createElement('div');
            gridFila.className = "grid grid-cols-2 md:grid-cols-5 gap-4";

            const seccionesOrdenadas = Array.from(gradosAgrupados[gradoNum]).sort();
            
            seccionesOrdenadas.forEach(gradoSec => {
                gridFila.innerHTML += `
                    <button onclick="window.verAlumnosGrado('${gradoSec}')" 
                        class="bg-white border-2 border-green-100 p-6 rounded-2xl hover:bg-green-600 hover:text-white transition-all transform hover:scale-105 shadow-sm text-center">
                        <span class="block text-2xl font-black text-green-800">${gradoSec}</span>
                        <span class="text-[9px] font-bold uppercase opacity-60">Ver Alumnos</span>
                    </button>`;
            });

            filaDiv.appendChild(gridFila);
            contenedorPrincipal.appendChild(filaDiv);
        });

    } catch (e) { 
        console.error("Error al cargar bloques:", e);
        contenedorPrincipal.innerHTML = `<p class='text-red-500'>Error: ${e.message}</p>`;
    }
};

window.imprimirTodosLosCarnets = () => {
    if (alumnosFiltradosMemoria.length === 0) return alert("No hay alumnos.");

    const ventana = window.open('', '', 'height=800,width=1000');
    let contenidoCarnets = '';
    
    alumnosFiltradosMemoria.forEach(a => {
        const nombreCompleto = (a.nombres || "SIN NOMBRE").toUpperCase();

        contenidoCarnets += `
            <div class="carnet">
                <div class="cabecera">I.E. HORACIO ZEBALLOS GÁMEZ - MALINGAS</div>
                <div class="contenido">
                    <div class="logo-seccion"><img src="logo_colegio.jpeg" class="logo-img"></div>
                    <div class="info-estudiante">
                        <div class="label-est">ESTUDIANTE:</div>
                        <div class="nombre-val">${nombreCompleto}</div>
                        
                        <div class="datos-contenedor">
                            <div class="datos-linea">DNI: <span>${a.dni}</span></div>
                            <div class="datos-linea">AULA: <span>${a.grado}° "${a.seccion}"</span></div>
                        </div>
                    </div>
                    <div class="qr-box"><div class="qr-code" data-dni="${a.dni}"></div></div>
                </div>
                <div class="footer">DISCIPLINA • LEALTAD • HONRADEZ</div>
            </div>
        `;
    });

    ventana.document.write(`
        <html>
        <head>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700;900&display=swap');
                body { font-family: 'Roboto', sans-serif; margin: 0; padding: 10px; }
                
                .contenedor-impresion {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 15px;
                }

                .carnet { 
                    width: 8.6cm; height: 5.4cm; 
                    background: white; border-radius: 12px; position: relative; 
                    overflow: hidden; border: 1.2px solid #000; page-break-inside: avoid;
                }

                .cabecera { 
                    background: #15803D; color: white; padding: 6px; text-align: center; 
                    font-size: 11px; font-weight: 900; 
                }

                .contenido { display: flex; padding: 10px 15px; align-items: center; height: 3.6cm; }
                .logo-img { width: 55px; height: auto; }

                .info-estudiante { flex: 1; padding: 0 12px; display: flex; flex-direction: column; justify-content: center; }
                
                .label-est { font-size: 9px; color: #15803D; font-weight: 900; margin-bottom: 2px; }

                /* MEJORA: Letras mucho más grandes y legibles */
                .nombre-val { 
                    font-size: 16px; /* Aumentado de 13px */
                    color: #000; 
                    font-weight: 900; 
                    line-height: 1.1; 
                    margin-bottom: 10px;
                    word-wrap: break-word;
                }

                .datos-contenedor { border-top: 1px solid #eee; pt: 5px; }
                .datos-linea { font-size: 13px; font-weight: 900; color: #15803D; margin-top: 3px; }
                .datos-linea span { color: #000; }

                .qr-box { width: 75px; height: 75px; display: flex; justify-content: center; align-items: center; }
                .footer { position: absolute; bottom: 0; width: 100%; background: #f0fdf4; text-align: center; font-size: 10px; color: #15803D; font-weight: 900; padding: 5px 0; border-top: 1.5px solid #15803D; }

                @media print {
                    @page { size: A4; margin: 0.5cm; }
                    .carnet { -webkit-print-color-adjust: exact; }
                }
            </style>
        </head>
        <body>
            <div class="contenedor-impresion">${contenidoCarnets}</div>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
            <script>
                document.querySelectorAll('.qr-code').forEach(div => {
                    new QRCode(div, { text: div.getAttribute('data-dni'), width: 75, height: 75, correctLevel: QRCode.CorrectLevel.H });
                });
                setTimeout(() => { window.print(); window.close(); }, 1000);
            </script>
        </body>
        </html>
    `);
    ventana.document.close();
};

// CRÍTICO: Esta función debe ser window. para que el HTML la detecte
let alumnosTodosMemoria = [];
let alumnosFiltradosMemoria = [];
let paginaActualAlumnos = 1;
const filasPorPagina = 10;
let gradoSeleccionadoActual = "";

window.verAlumnosGrado = (gradoSecSeleccionado) => {
    const contenedor = document.getElementById('contenedorBloques');
    const vistaTabla = document.getElementById('vistaTablaAlumnos');
    const btnVolver = document.getElementById('btnVolverBloques');
    const titulo = document.getElementById('tituloLista');
    // Referencia al botón de impresión masiva
    const btnImprimirTodo = document.getElementById('btnImprimirTodoGrado');
    
    contenedor.classList.add('hidden');
    vistaTabla.classList.remove('hidden');
    btnVolver.classList.remove('hidden');

    // MOSTRAR botón de impresión masiva al entrar a un grado
    if (btnImprimirTodo) btnImprimirTodo.classList.remove('hidden');

    titulo.innerText = `ALUMNOS DE ${gradoSecSeleccionado}`;

    onSnapshot(collection(db, "alumnos"), (snapshot) => {
        alumnosTodosMemoria = []; 
        
        snapshot.forEach(docSnap => {
            const a = docSnap.data();
            const combinacion = `${a.grado}${a.seccion}`.toUpperCase();
            
            if (combinacion === gradoSecSeleccionado) {
                alumnosTodosMemoria.push({ id: docSnap.id, ...a });
            }
        });

        alumnosTodosMemoria.sort((a, b) => a.nombres.localeCompare(b.nombres));
        alumnosFiltradosMemoria = [...alumnosTodosMemoria]; 
        
        paginaActualAlumnos = 1; 
        renderizarTablaConPaginacion();
    });
};

function renderizarTablaConPaginacion() {
    const tabla = document.getElementById('tablaAlumnos');
    if (!tabla) return;
    tabla.innerHTML = "";

    const inicio = (paginaActualAlumnos - 1 ) * filasPorPagina;
    const fin = inicio + filasPorPagina;
    const subsetAlumnos = alumnosFiltradosMemoria.slice(inicio, fin);

    if (subsetAlumnos.length === 0) {
        tabla.innerHTML = `<tr><td colspan="5" class="p-10 text-center italic text-slate-400">No hay alumnos para mostrar.</td></tr>`;
        return;
    }

    subsetAlumnos.forEach(a => {
        // Usamos backticks (`) para el template string
        tabla.innerHTML += `
            <tr class="border-b hover:bg-green-50 transition">
                <td class="p-4 font-mono text-sm text-slate-600">${a.dni}</td>
                <td class="p-4 font-bold text-slate-700 uppercase">${a.nombres}</td>
                <td class="p-4 text-center">
                    <span class="bg-slate-100 text-slate-600 px-2 py-1 rounded-md text-xs font-black">${a.grado}°</span>
                </td>
                <td class="p-4 text-center">
                    <span class="bg-slate-100 text-slate-600 px-2 py-1 rounded-md text-xs font-black">${a.seccion}</span>
                </td>
                <td class="p-4 text-center space-x-2">
                    <div class="flex justify-center gap-2">
                        <button onclick="window.imprimirCarnet('${a.dni}')" 
                                class="bg-green-100 text-green-700 px-3 py-1 rounded font-bold text-[10px] hover:bg-green-600 hover:text-white transition">
                            CARNET
                        </button>
                        <button onclick="window.editarAlumno('${a.dni}', '${a.nombres}', '${a.grado}', '${a.seccion}', '${a.telefono}')" 
                                class="bg-yellow-100 text-yellow-700 px-3 py-1 rounded font-bold text-[10px] hover:bg-yellow-600 hover:text-white transition">
                            EDITAR
                        </button>
                        <button onclick="window.eliminarAlumno('${a.dni}')" class="text-red-500 hover:scale-125 transition">
                            ❌
                        </button>
                    </div>
                </td>
            </tr>`;
    });

    crearControlesPaginacion();
}

function crearControlesPaginacion() {
    let divPaginacion = document.getElementById('paginacionAlumnos');
    
    // Si no existe el div de controles, lo creamos
    if (!divPaginacion) {
        divPaginacion = document.createElement('div');
        divPaginacion.id = 'paginacionAlumnos';
        divPaginacion.className = "flex justify-center items-center gap-4 mt-6 p-4 bg-slate-50 rounded-xl border border-slate-100";
        document.getElementById('vistaTablaAlumnos').appendChild(divPaginacion);
    }

    const totalPaginas = Math.ceil(alumnosFiltradosMemoria.length / filasPorPagina);

    divPaginacion.innerHTML = `
        <button onclick="window.moverPaginaAlumnos(-1)" 
                ${paginaActualAlumnos === 1 ? 'disabled' : ''} 
                class="px-4 py-2 bg-white border rounded-lg font-bold text-xs disabled:opacity-30 hover:bg-slate-100 transition">
            ANTERIOR
        </button>
        <span class="text-xs font-black text-slate-500 uppercase">
            Página ${paginaActualAlumnos} de ${totalPaginas || 1}
        </span>
        <button onclick="window.moverPaginaAlumnos(1)" 
                ${paginaActualAlumnos === totalPaginas || totalPaginas === 0 ? 'disabled' : ''} 
                class="px-4 py-2 bg-white border rounded-lg font-bold text-xs disabled:opacity-30 hover:bg-slate-100 transition">
            SIGUIENTE
        </button>
    `;
}

window.moverPaginaAlumnos = (dir) => {
    paginaActualAlumnos += dir;
    renderizarTablaConPaginacion();
    // Scroll suave al inicio de la tabla para mejor experiencia
    document.getElementById('buscador').scrollIntoView({ behavior: 'smooth' });
};
// --- FUNCIONES DE APOYO ---
window.editarAlumno = (dni, nombres, grado, seccion, telefono) => {
    document.getElementById('dni').value = dni;
    document.getElementById('nombres').value = nombres;
    document.getElementById('grado').value = grado;
    document.getElementById('seccion').value = seccion;
    document.getElementById('telefono').value = telefono;
    window.mostrarSeccion('registro');
};

window.eliminarAlumno = async (id) => { if(confirm("¿Eliminar?")) await deleteDoc(doc(db, "alumnos", id)); };

window.justificarFalta = async (dni, nombre) => {
    // 1. Definimos las opciones del prompt
    const n = prompt(`Cambiar estado para ${nombre.toUpperCase()}:\n1. Puntual\n2. Tardanza\n3. Salida por Salud\n4. Tardanza Justificada\n5. Falta Justificada\n6. Falta`, "5");
    
    // Obtenemos la hora actual para el registro de salida
    const ahora = new Date();
    const horaSalida = ahora.toLocaleTimeString('en-GB'); // Formato HH:MM:SS

    // 2. Mapeo de estados (Aseguramos que el índice coincida con el número ingresado)
    const estados = [
        "", 
        "Puntual", 
        "Tardanza", 
        `Salida por Salud (${horaSalida})`, // Inyectamos la hora aquí
        "Tardanza Justificada", 
        "Falta Justificada", 
        "Falta"
    ];
    
    const nuevoEstado = estados[n];

    if (!nuevoEstado) return;
    
    // Obtenemos la fecha del input de consulta o la fecha de hoy
    const hoy = document.getElementById('fechaConsulta')?.value || new Date().toLocaleDateString('en-CA');

    try {
        // 3. Actualizar en Firebase
        await setDoc(doc(db, "asistencia", hoy, "registros", dni), { 
            estado: nuevoEstado 
        }, { merge: true });

        // 4. Recuperar teléfono y enviar notificación
        const docAlu = await getDoc(doc(db, "alumnos", dni));
        if (docAlu.exists() && docAlu.data().telefono) {
            const tel = docAlu.data().telefono;
            const msj = `*ACTUALIZACIÓN INSTITUCIONAL*\n\nSe informa que la situación de *${nombre.toUpperCase()}* ha sido actualizada a: *${nuevoEstado.toUpperCase()}*.\n\n_I.E. Horacio Zeballos Gámez_`;
            
            await window.enviarNotificacionUltraMsg(tel, nombre, nuevoEstado, msj);
            alert(`✅ Estado actualizado: ${nuevoEstado}\nPadre notificado con éxito.`);
            
            // Refrescar la vista si la función existe
            if(typeof window.actualizarVistaAsistencia === 'function') window.actualizarVistaAsistencia();
        }
    } catch (e) { 
        console.error(e);
        alert("❌ Error al actualizar en la base de datos."); 
    }
};

window.enviarNotificacionUltraMsg = async (telefono, nombre, estado, mensajePersonalizado = null) => {
    const url = "https://api.ultramsg.com/instance169160/messages/chat";
    const token = "bkd2pujvtq9icz2w";
    
    // Si no hay mensaje personalizado, usa el estándar
    const mensaje = mensajePersonalizado || `*INGRESO*\n\nSe informa que el estudiante *${nombre}* registró su ingreso como: *${estado.toUpperCase()}*.`;

    const params = new URLSearchParams();
    params.append('token', token);
    params.append('to', `+51${telefono}`);
    params.append('body', mensaje);
    params.append('priority', '10');

    try {
        await fetch(url, { method: 'POST', body: params });
    } catch (e) {
        console.error("Error UltraMsg:", e);
    }
};
// --- NUEVA FUNCIÓN: Ajuste Dinámico de Texto ---
window.ajustarTextoDinámico = (elementoId) => {
    const elemento = document.getElementById(elementoId);
    if (!elemento) return;

    const contenedor = elemento.parentElement;
    let tamañoFuente = parseInt(window.getComputedStyle(elemento).fontSize);

    // Bucle para reducir el tamaño de fuente si el texto se sale del contenedor
    // (Ancho máximo del carnet es ~300px)
    while (elemento.scrollWidth > contenedor.offsetWidth && tamañoFuente > 8) {
        tamañoFuente--; // Reducimos 1px
        elemento.style.fontSize = tamañoFuente + 'px';
    }
};

// --- FUNCIÓN DE BÚSQUEDA ---
window.filtrarAlumnos = () => {
    const texto = document.getElementById('buscador').value.toLowerCase().trim();

    if (texto === "") {
        // Si el buscador está vacío, mostramos todos de nuevo
        alumnosFiltradosMemoria = [...alumnosTodosMemoria];
    } else {
        // Filtramos sobre el respaldo original 'alumnosTodosMemoria'
        alumnosFiltradosMemoria = alumnosTodosMemoria.filter(a =>
            (a.nombres && a.nombres.toLowerCase().includes(texto)) || 
            (a.dni && a.dni.includes(texto))
        );
    }
    
    paginaActualAlumnos = 1; // Reiniciamos a la página 1 para ver los resultados
    renderizarTablaConPaginacion();
};


// Iniciar procesos
iniciarControlAsistencia();