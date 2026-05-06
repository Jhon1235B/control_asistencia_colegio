import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getFirestore, collection, doc, setDoc, onSnapshot, 
    deleteDoc, getDoc, getDocs, query, writeBatch 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const NUEVA_API_URL = 'https://ugeltambogrande.260mb.net/simgcase/ajax_enviar_whatsapp.php';

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
const auth = getAuth(app);

// 1. Proteger el sistema al cargar la página
document.addEventListener('DOMContentLoaded', () => {
    // Ocultar las secciones del sistema hasta validar la sesión
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));

    onAuthStateChanged(auth, (user) => {
        const loginSection = document.getElementById('sec-login');
        if (user) {
            // Usuario autenticado, mostramos la sección principal (ej. Registro) y ocultamos el login
            if (loginSection) loginSection.classList.add('hidden');
            document.getElementById('sec-registro').classList.remove('hidden');
        } else {
            // No hay sesión activa, mostramos la pantalla de login
            if (loginSection) loginSection.classList.remove('hidden');
        }
    });

    const registroForm = document.getElementById('registroForm');
    if(registroForm) {
        registroForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const dni = document.getElementById('dni').value;
            const datos = {
                dni: dni,
                nombres: document.getElementById('nombres').value.toUpperCase(),
                apoderado: document.getElementById('apoderado').value.toUpperCase(),
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
    
    // 2. Manejar el evento de envío del formulario de login
    const formLogin = document.getElementById('formLogin');
    if (formLogin) {
        formLogin.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;

            try {
                await signInWithEmailAndPassword(auth, email, password);
                alert("¡Bienvenido al sistema!");
                document.getElementById('sec-login').classList.add('hidden');
                document.getElementById('sec-registro').classList.remove('hidden');
            } catch (error) {
                alert("Error al iniciar sesión: " + error.message);
            }
        });
    }
    
    // Llamamos a la inicialización aquí
    if (typeof iniciarControlAsistencia === 'function') {
        iniciarControlAsistencia(); 
    }
});

// 3. Función para cerrar sesión
window.cerrarSesion = async () => {
    try {
        await signOut(auth);
        window.location.reload();
    } catch (error) {
        console.error("Error al cerrar sesión", error);
    }
};

window.cambiarFechaAsistencia = (nuevaFecha) => {
    console.log("Cambiando vista a:", nuevaFecha);
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
    if (!confirm("¿Finalizar día y marcar como PUNTUAL (07:45 AM) a los alumnos restantes?")) return;

    try {
        const batch = writeBatch(db); 
        const snapAlumnos = await getDocs(collection(db, "alumnos"));
        const snapAsistencia = await getDocs(collection(db, "asistencia", hoy, "registros"));
        
        const asistieronDni = new Set();
        snapAsistencia.forEach(docSnap => asistieronDni.add(docSnap.id));

        let contRegistrados = 0;

        for (const docAlumno of snapAlumnos.docs) {
            const dni = docAlumno.id;
            const datosAlu = docAlumno.data();

            if (!asistieronDni.has(dni)) {
                contRegistrados++;
                
                const refAsistencia = doc(db, "asistencia", hoy, "registros", dni);
                const horaFija = "07:45:00";
                
                // 1. Registro automático en Firebase
                batch.set(refAsistencia, {
                    nombres: datosAlu.nombres,
                    apoderado: datosAlu.apoderado || "",
                    hora: horaFija,
                    estado: "Puntual",
                    fecha: hoy,
                    grado: datosAlu.grado || "?", 
                    seccion: datosAlu.seccion || "?"
                }, { merge: true });

                // 2. Notificación con el formato exacto solicitado
                if (datosAlu.telefono) {
                    const nombreApoderado = datosAlu.apoderado ? datosAlu.apoderado.toUpperCase() : "APODERADO";
                    const estudiante = datosAlu.nombres.toUpperCase();
                    
                    const mensajeAuto = `*CONTROL DE ASISTENCIA HZG*\n\n` +
                                      `Estimado(a) *${nombreApoderado}*, se le informa que el estudiante:\n` +
                                      `Estudiante: *${estudiante}*\n` +
                                      `Estado: *PUNTUAL*\n` +
                                      `Hora de Ingreso: ${horaFija}\n\n` +
                                      `_Malingas: Disciplina, Lealtad, Honradez._`;
                    
                    await window.enviarNotificacionUltraMsg(datosAlu.telefono, estudiante, "Puntual", mensajeAuto);
                }
            }
        }

        await batch.commit(); 
        alert(`Éxito: Se regularizaron ${contRegistrados} alumnos como Puntual.`);
        
    } catch (error) {
        console.error("Error en cerrarDia:", error);
        alert("Error al finalizar el día: " + error.message);
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
            ${reg.apoderado ? `<div class="text-[9px] text-blue-600 font-bold uppercase">APODODDERADO: ${reg.apoderado}</div>` : ''} 
        </td>
        
        <td class="p-3 flex-grow">
            <div class="flex flex-col gap-1 items-start">
                <span class="px-2 py-0.5 rounded-full text-[9px] font-black ${color}">
                    ${reg.estado?.toUpperCase() || 'FALTÓ'}
                </span>
                
                <div class="flex flex-wrap gap-1 mt-1">
                    ${reg.alertaSalud ? `
                        <span class="bg-blue-600 text-white px-2 py-0.5 rounded text-[8px] font-bold shadow-sm uppercase">
                            🚑 ${reg.alertaSalud}
                        </span>
                    ` : ''}

                    ${reg.alertaConducta ? `
                        <span class="bg-red-500 text-white px-2 py-0.5 rounded text-[8px] font-bold shadow-sm uppercase">
                            ⚠️ ${reg.alertaConducta}
                        </span>
                    ` : ''}

                    ${reg.alertaCorte ? `
                        <span class="bg-orange-500 text-white px-2 py-0.5 rounded text-[8px] font-bold shadow-sm uppercase">
                            ✂️ ${reg.alertaCorte}
                        </span>
                    ` : ''}

                    ${reg.alertaVestimenta ? `
                        <span class="bg-purple-500 text-white px-2 py-0.5 rounded text-[8px] font-bold shadow-sm uppercase">
                            👔 ${reg.alertaVestimenta}
                        </span>
                    ` : ''}
                </div>
            </div>
        </td>
        
        <td class="p-3 text-right w-24">
            <button onclick="window.justificarFalta('${reg.dni}', '${reg.nombres}')"
                    class="text-[10px] font-black text-blue-600 hover:text-blue-800 uppercase tracking-tighter hover:underline">
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
// ═══════════════════════════════════════════════════════
// MÓDULO DE REPORTE MENSUAL — GRILLA DÍA A DÍA v2
// ═══════════════════════════════════════════════════════

const DIAS_SEMANA_CORTO = ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'];
const MESES_ES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                  'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];

// Tipos de incidencia: clave en el registro → etiqueta corta para mostrar
const TIPOS_INCIDENCIA = [
    { campo: 'alertaConducta',  emoji: '⚠️', label: 'Conducta'   },
    { campo: 'alertaVestimenta',emoji: '👔', label: 'Vestimenta' },
    { campo: 'alertaCorte',     emoji: '✂️', label: 'Corte'      },
    { campo: 'alertaSalud',     emoji: '🚑', label: 'Salud'      },
];

/** Devuelve info de celda para un registro de un día */
function getEstadoCelda(reg) {
    if (!reg) return { letra:'F', bg:'#ef4444', color:'#fff', titulo:'Sin registro', tieneIncidencia:false, detalleInc:[] };

    const estado = (reg.estado || '').toLowerCase();
    let letra, bg, titulo;

    if (estado.includes('falta justificada'))    { letra='J'; bg='#6366f1'; titulo=reg.estado; }
    else if (estado.includes('tardanza justificada')) { letra='J'; bg='#3b82f6'; titulo=reg.estado; }
    else if (estado.includes('tardanza'))        { letra='T'; bg='#f59e0b'; titulo=(reg.estado||'Tardanza')+(reg.hora?' ('+reg.hora+')':''); }
    else if (estado.includes('falta'))           { letra='F'; bg='#ef4444'; titulo=reg.estado; }
    else if (estado !== '')                      { letra='A'; bg='#22c55e'; titulo='Asistió'+(reg.hora?' ('+reg.hora+')':''); }
    else                                         { letra='F'; bg='#ef4444'; titulo='Falta'; }

    const detalleInc = TIPOS_INCIDENCIA
        .filter(t => reg[t.campo])
        .map(t => ({ emoji: t.emoji, label: t.label, valor: reg[t.campo] }));

    return { letra, bg, color:'#fff', titulo, tieneIncidencia: detalleInc.length > 0, detalleInc };
}

window.generarReporteDiarioGeneral = async () => {
    const mes          = document.getElementById('mesConsulta')?.value;
    const filtroGrado  = document.getElementById('filtroGrado')?.value  || "";
    const filtroSec    = document.getElementById('filtroSeccion')?.value || "";
    const tbody        = document.getElementById('tablaReporteGeneral');
    const thead        = document.getElementById('theadReporteMensual');

    if (!mes) { alert("Selecciona un mes primero."); return; }

    tbody.innerHTML = `<tr><td colspan="10" class="p-10 text-center text-slate-400 italic">⏳ Cargando reporte de ${mes}…</td></tr>`;
    if (thead) thead.innerHTML = '';

    try {
        const [year, month] = mes.split('-').map(Number);
        const diasEnMes = new Date(year, month, 0).getDate();

        // ── Fechas del mes ──────────────────────────────────
        const fechas = [];
        for (let d = 1; d <= diasEnMes; d++) {
            const fecha = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            fechas.push({ fecha, dia: d, diaSemana: new Date(year, month-1, d).getDay() });
        }

        // ── Cargar alumnos ──────────────────────────────────
        const snapAlumnos = await getDocs(collection(db, "alumnos"));
        const alumnos = {};
        snapAlumnos.forEach(docAlu => {
            const d = docAlu.data();
            const gr  = String(d.grado   || '').trim();
            const sec = String(d.seccion || '').trim().toUpperCase();
            if (filtroGrado && gr  !== filtroGrado)              return;
            if (filtroSec   && sec !== filtroSec.toUpperCase())  return;
            alumnos[docAlu.id] = {
                ...d, dni: docAlu.id,
                diasReg: {},       // fecha → datos del registro
                listadoInc: [],    // [{ fecha, diaSemana, emoji, label, valor }]
                asistencias: 0, tardanzas: 0, faltas: 0, justificados: 0, incidencias: 0
            };
        });

        // ── Cargar asistencia día a día ─────────────────────
        const LOTE = 7;
        for (let i = 0; i < fechas.length; i += LOTE) {
            const lote = fechas.slice(i, i + LOTE);
            const snaps = await Promise.all(
                lote.map(f => getDocs(collection(db, "asistencia", f.fecha, "registros")))
            );
            snaps.forEach((snap, si) => {
                const fInfo = lote[si];
                snap.forEach(docReg => {
                    const dni = docReg.id;
                    if (!alumnos[dni]) return;
                    const data = docReg.data();
                    alumnos[dni].diasReg[fInfo.fecha] = data;

                    const est = (data.estado || '').toLowerCase();
                    if      (est.includes('justificad'))  alumnos[dni].justificados++;
                    if      (est.includes('tardanza'))    { alumnos[dni].tardanzas++; alumnos[dni].asistencias++; }
                    else if (est.includes('falta') && !est.includes('justificad')) alumnos[dni].faltas++;
                    else if (est !== '')                  alumnos[dni].asistencias++;
                    else                                  alumnos[dni].faltas++;

                    // Registrar incidencias con detalle
                    TIPOS_INCIDENCIA.forEach(t => {
                        if (data[t.campo]) {
                            alumnos[dni].incidencias++;
                            alumnos[dni].listadoInc.push({
                                fecha:     fInfo.fecha,
                                dia:       fInfo.dia,
                                diaSemana: fInfo.diaSemana,
                                emoji:     t.emoji,
                                label:     t.label,
                                valor:     data[t.campo]
                            });
                        }
                    });
                });
            });
        }

        // ── Ordenar ─────────────────────────────────────────
        const lista = Object.values(alumnos).sort((a, b) => {
            const gc = String(a.grado||'').localeCompare(String(b.grado||''));
            if (gc) return gc;
            const sc = String(a.seccion||'').localeCompare(String(b.seccion||''));
            if (sc) return sc;
            return (a.nombres||'').localeCompare(b.nombres||'');
        });

        window.reporteMensualData   = lista;
        window.reporteMensualFechas = fechas;
        window.reporteMensualMes    = mes;

        if (lista.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="p-10 text-center text-slate-400 italic">No hay alumnos con los filtros seleccionados.</td></tr>`;
            return;
        }

        // ── Subtítulo ───────────────────────────────────────
        const mesLabel = MESES_ES[month - 1];
        const sub = document.getElementById('reporteSubtitulo');
        if (sub) {
            const gL = filtroGrado ? `${filtroGrado}° Grado` : 'Todos los Grados';
            const sL = filtroSec   ? `Sección ${filtroSec}`  : 'Todas las Secciones';
            sub.textContent = `Año: ${year} | ${gL} | ${sL} | Mes: ${mesLabel} | ${lista.length} estudiantes | ${diasEnMes} días`;
        }

        // ── ENCABEZADO ──────────────────────────────────────
        // Calcular número de columnas fijas (N°, Nombre, DNI, Sexo) = 4
        const colsFijas = 4;
        const colsTotal = colsFijas + diasEnMes + 5; // +5: A, T, F, J, Inc

        if (thead) {
            let thHTML = `<tr>
                <th class="sticky left-0 z-30 bg-green-800 px-1 py-2 text-center border border-green-600 text-[10px]" style="min-width:30px">N°</th>
                <th class="sticky left-[30px] z-30 bg-green-800 px-2 py-2 text-left border border-green-600 text-[10px]" style="min-width:210px">APELLIDOS Y NOMBRES</th>
                <th class="bg-green-800 px-1 py-2 text-center border border-green-600 text-[10px]" style="min-width:75px">DNI</th>
                <th class="bg-green-800 px-1 py-2 text-center border border-green-600 text-[10px]" style="min-width:55px">SEXO</th>`;

            fechas.forEach(f => {
                const bgDia = f.diaSemana === 0 ? '#7f1d1d'
                            : f.diaSemana === 6 ? '#14532d'
                            : '#15803d';
                thHTML += `<th style="min-width:26px;max-width:26px;background:${bgDia};border:1px solid #166534;padding:3px 1px;text-align:center;vertical-align:bottom;">
                    <div style="font-size:8px;font-weight:900;color:#fff;line-height:1.1;">${DIAS_SEMANA_CORTO[f.diaSemana]}</div>
                    <div style="font-size:10px;font-weight:900;color:#fff;line-height:1.2;">${f.dia}</div>
                </th>`;
            });

            // Resumen col headers
            const resumenCols = [
                { label:'ASIST.',  bg:'#15803d', title:'Total días asistidos (incluye tardanzas)' },
                { label:'TARD.',   bg:'#d97706', title:'Total tardanzas' },
                { label:'FALTAS',  bg:'#b91c1c', title:'Total faltas' },
                { label:'JUSTIF.', bg:'#1d4ed8', title:'Total justificados' },
                { label:'INCID.',  bg:'#ea580c', title:'Total incidencias (conducta, vestimenta, corte, salud)' },
            ];
            resumenCols.forEach(rc => {
                thHTML += `<th title="${rc.title}" style="min-width:40px;background:${rc.bg};border:1px solid rgba(255,255,255,0.2);padding:4px 2px;text-align:center;font-size:9px;font-weight:900;color:#fff;vertical-align:bottom;">${rc.label}</th>`;
            });

            thHTML += `</tr>`;
            thead.innerHTML = thHTML;
        }

        // ── FILAS ───────────────────────────────────────────
        tbody.innerHTML = '';
        const fragment = document.createDocumentFragment();

        // Contadores para fila TOTALES
        const totA = [], totT = [], totF = [];
        fechas.forEach(() => { totA.push(0); totT.push(0); totF.push(0); });
        let sumA=0, sumT=0, sumF=0, sumJ=0, sumInc=0;

        lista.forEach((alu, idx) => {
            // ── Fila principal ─────────────────────────────
            const tr = document.createElement('tr');
            tr.style.cssText = `background:${idx%2===0?'#fff':'#f8fafc'};`;

            const bgFila = idx%2===0 ? '#fff' : '#f8fafc';

            let celdas = `
                <td style="position:sticky;left:0;z-index:10;background:${bgFila};min-width:30px;padding:3px 2px;text-align:center;border:1px solid #e2e8f0;font-size:11px;font-weight:700;color:#64748b;">${idx+1}</td>
                <td style="position:sticky;left:30px;z-index:10;background:${bgFila};min-width:210px;padding:3px 6px;border:1px solid #e2e8f0;">
                    <div style="font-size:11px;font-weight:800;color:#1e293b;text-transform:uppercase;line-height:1.2;">${alu.nombres||'S/N'}</div>
                    <div style="font-size:9px;color:#94a3b8;font-family:monospace;">DNI: ${alu.dni}</div>
                </td>
                <td style="padding:3px 2px;text-align:center;border:1px solid #e2e8f0;font-size:10px;font-family:monospace;color:#64748b;">${alu.dni}</td>
                <td style="padding:3px 2px;text-align:center;border:1px solid #e2e8f0;font-size:10px;font-weight:700;color:#475569;">${alu.sexo||'—'}</td>`;

            fechas.forEach((f, fi) => {
                const reg = alu.diasReg[f.fecha];
                const esFinSemana = f.diaSemana === 0 || f.diaSemana === 6;

                if (esFinSemana) {
                    celdas += `<td style="background:#e2e8f0;min-width:26px;max-width:26px;border:1px solid #cbd5e1;"></td>`;
                } else {
                    const c = getEstadoCelda(reg);

                    // Acumular totales por columna-día
                    if (c.letra==='A') totA[fi]++;
                    if (c.letra==='T') totT[fi]++;
                    if (c.letra==='F') totF[fi]++;

                    const incBorder = c.tieneIncidencia ? `box-shadow:inset 0 0 0 2px #f97316;` : '';
                    const incDot    = c.tieneIncidencia
                        ? `<div style="font-size:7px;color:#f97316;font-weight:900;line-height:1;margin-top:1px;">▲</div>`
                        : '';
                    const tituloFull = c.titulo + (c.detalleInc.length ? ' │ ' + c.detalleInc.map(i=>i.label).join(', ') : '');

                    celdas += `<td title="${tituloFull}" style="min-width:26px;max-width:26px;padding:2px 1px;text-align:center;border:1px solid #e2e8f0;vertical-align:middle;">
                        <div style="display:inline-flex;flex-direction:column;align-items:center;">
                            <span style="display:inline-block;width:20px;height:20px;border-radius:3px;background:${c.bg};color:#fff;font-size:10px;font-weight:900;line-height:20px;text-align:center;${incBorder}">${c.letra}</span>
                            ${incDot}
                        </div>
                    </td>`;
                }
            });

            // ── Columnas resumen ───────────────────────────
            sumA   += alu.asistencias;
            sumT   += alu.tardanzas;
            sumF   += alu.faltas;
            sumJ   += alu.justificados;
            sumInc += alu.incidencias;

            celdas += `
                <td style="padding:3px 2px;text-align:center;border:1px solid #e2e8f0;">
                    <span style="display:inline-block;background:#22c55e;color:#fff;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:900;min-width:22px;text-align:center;">${alu.asistencias}</span>
                </td>
                <td style="padding:3px 2px;text-align:center;border:1px solid #e2e8f0;">
                    <span style="display:inline-block;background:#f59e0b;color:#fff;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:900;min-width:22px;text-align:center;">${alu.tardanzas}</span>
                </td>
                <td style="padding:3px 2px;text-align:center;border:1px solid #e2e8f0;">
                    <span style="display:inline-block;background:#ef4444;color:#fff;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:900;min-width:22px;text-align:center;">${alu.faltas}</span>
                </td>
                <td style="padding:3px 2px;text-align:center;border:1px solid #e2e8f0;">
                    <span style="display:inline-block;background:#3b82f6;color:#fff;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:900;min-width:22px;text-align:center;">${alu.justificados}</span>
                </td>
                <td style="padding:3px 2px;text-align:center;border:1px solid #e2e8f0;">
                    <span style="display:inline-block;background:${alu.incidencias>0?'#ea580c':'#e2e8f0'};color:${alu.incidencias>0?'#fff':'#94a3b8'};padding:1px 6px;border-radius:4px;font-size:11px;font-weight:900;min-width:22px;text-align:center;">${alu.incidencias}</span>
                </td>`;

            tr.innerHTML = celdas;
            fragment.appendChild(tr);

            // ── Fila de incidencias detalladas ─────────────
            if (alu.listadoInc.length > 0) {
                const trInc = document.createElement('tr');
                trInc.style.cssText = `background:#fff7ed;`;

                // Agrupar incidencias: fecha → lista
                const incPorDia = {};
                alu.listadoInc.forEach(inc => {
                    if (!incPorDia[inc.fecha]) incPorDia[inc.fecha] = [];
                    incPorDia[inc.fecha].push(inc);
                });

                // Columnas fijas (N° y nombre en la fila de incidencias)
                let incCeldas = `
                    <td colspan="2" style="position:sticky;left:0;z-index:10;background:#fff7ed;padding:3px 6px;border:1px solid #fed7aa;border-left:3px solid #f97316;">
                        <span style="font-size:9px;font-weight:900;color:#ea580c;text-transform:uppercase;">⚠ INCIDENCIAS — ${alu.nombres}</span>
                    </td>
                    <td style="background:#fff7ed;border:1px solid #fed7aa;"></td>
                    <td style="background:#fff7ed;border:1px solid #fed7aa;"></td>`;

                // Celdas por día
                fechas.forEach(f => {
                    const incs = incPorDia[f.fecha];
                    if (!incs || incs.length === 0) {
                        incCeldas += `<td style="background:#fff7ed;border:1px solid #fed7aa;min-width:26px;max-width:26px;"></td>`;
                    } else {
                        const tags = incs.map(i =>
                            `<span title="${i.valor}" style="display:inline-block;background:#ea580c;color:#fff;border-radius:3px;padding:0 3px;font-size:8px;font-weight:900;line-height:14px;margin:1px;">${i.emoji}${i.label}</span>`
                        ).join('');
                        incCeldas += `<td style="background:#fff7ed;border:1px solid #fed7aa;min-width:26px;max-width:26px;padding:2px;text-align:center;vertical-align:middle;">${tags}</td>`;
                    }
                });

                // Resumen vacío (la incidencia ya está contada en la fila principal)
                incCeldas += `<td style="background:#fff7ed;border:1px solid #fed7aa;" colspan="5">
                    <div style="padding:2px 6px;">
                        ${alu.listadoInc.map(i =>
                            `<span style="font-size:9px;color:#7c2d12;font-weight:700;">${i.emoji} <b>${i.label}</b> (día ${i.dia}): ${i.valor}</span><br>`
                        ).join('')}
                    </div>
                </td>`;

                trInc.innerHTML = incCeldas;
                fragment.appendChild(trInc);
            }
        });

        // ── FILA DE TOTALES ─────────────────────────────────
        const trTot = document.createElement('tr');
        trTot.style.cssText = `background:#f0fdf4;font-weight:900;border-top:3px solid #15803d;`;

        let totCeldas = `
            <td colspan="2" style="position:sticky;left:0;z-index:10;background:#dcfce7;padding:4px 8px;border:1px solid #86efac;font-size:11px;font-weight:900;color:#166534;text-transform:uppercase;">
                TOTALES GENERALES
            </td>
            <td style="background:#dcfce7;border:1px solid #86efac;"></td>
            <td style="background:#dcfce7;border:1px solid #86efac;"></td>`;

        fechas.forEach((f, fi) => {
            const esFinSemana = f.diaSemana === 0 || f.diaSemana === 6;
            if (esFinSemana) {
                totCeldas += `<td style="background:#e2e8f0;min-width:26px;max-width:26px;border:1px solid #cbd5e1;"></td>`;
            } else {
                const a = totA[fi] || 0;
                const t = totT[fi] || 0;
                const f2 = totF[fi] || 0;
                totCeldas += `<td style="min-width:26px;max-width:26px;padding:2px 1px;text-align:center;border:1px solid #86efac;vertical-align:top;font-size:8px;background:#f0fdf4;">
                    ${a>0?`<div style="color:#15803d;font-weight:900;line-height:1.2;">A:${a}</div>`:''}
                    ${t>0?`<div style="color:#d97706;font-weight:900;line-height:1.2;">T:${t}</div>`:''}
                    ${f2>0?`<div style="color:#dc2626;font-weight:900;line-height:1.2;">F:${f2}</div>`:''}
                </td>`;
            }
        });

        totCeldas += `
            <td style="padding:4px 2px;text-align:center;border:1px solid #86efac;background:#dcfce7;">
                <span style="background:#15803d;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:900;">${sumA}</span>
            </td>
            <td style="padding:4px 2px;text-align:center;border:1px solid #86efac;background:#dcfce7;">
                <span style="background:#d97706;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:900;">${sumT}</span>
            </td>
            <td style="padding:4px 2px;text-align:center;border:1px solid #86efac;background:#dcfce7;">
                <span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:900;">${sumF}</span>
            </td>
            <td style="padding:4px 2px;text-align:center;border:1px solid #86efac;background:#dcfce7;">
                <span style="background:#1d4ed8;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:900;">${sumJ}</span>
            </td>
            <td style="padding:4px 2px;text-align:center;border:1px solid #86efac;background:#dcfce7;">
                <span style="background:${sumInc>0?'#ea580c':'#e2e8f0'};color:${sumInc>0?'#fff':'#94a3b8'};padding:2px 8px;border-radius:4px;font-size:12px;font-weight:900;">${sumInc}</span>
            </td>`;

        trTot.innerHTML = totCeldas;
        fragment.appendChild(trTot);

        tbody.appendChild(fragment);

    } catch (err) {
        console.error("Error en reporte mensual:", err);
        tbody.innerHTML = `<tr><td colspan="10" class="p-10 text-center text-red-500 italic">Error: ${err.message}</td></tr>`;
    }
};

window.descargarReporteMensualExcel = () => {
    if (!window.reporteMensualData || window.reporteMensualData.length === 0) {
        alert("Primero genere un reporte para descargar.");
        return;
    }

    const fechas = window.reporteMensualFechas || [];
    const DS = ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'];
    const mes = window.reporteMensualMes || document.getElementById('mesConsulta').value || 'mes';

    // ── Construir filas de datos ────────────────────────────
    const dataExcel = window.reporteMensualData.map((item, idx) => {
        const row = {};
        row["N°"]                  = idx + 1;
        row["APELLIDOS Y NOMBRES"] = item.nombres || '';
        row["DNI"]                 = item.dni     || '';
        row["SEXO"]                = item.sexo    || '';

        fechas.forEach(f => {
            const colKey = `${DS[f.diaSemana]} ${f.dia}`;
            const esFinSemana = f.diaSemana === 0 || f.diaSemana === 6;
            if (esFinSemana) { row[colKey] = ''; return; }
            const reg = item.diasReg ? item.diasReg[f.fecha] : null;
            if (!reg) { row[colKey] = 'F'; return; }
            const est = (reg.estado || '').toLowerCase();
            let letra = 'A';
            if (est.includes('justificad'))     letra = 'J';
            else if (est.includes('tardanza'))  letra = 'T';
            else if (est.includes('falta'))     letra = 'F';
            // Marcar incidencia con asterisco
            const hasInc = reg.alertaSalud || reg.alertaConducta || reg.alertaCorte || reg.alertaVestimenta;
            row[colKey] = hasInc ? letra + '*' : letra;
        });

        row["ASIST."]  = item.asistencias  || 0;
        row["TARD."]   = item.tardanzas    || 0;
        row["FALTAS"]  = item.faltas       || 0;
        row["JUSTIF."] = item.justificados || 0;
        row["INCID."]  = item.incidencias  || 0;

        // Detalle de incidencias como texto
        const detalle = (item.listadoInc || []).map(i =>
            `Día ${i.dia} (${DS[i.diaSemana]}): [${i.label}] ${i.valor}`
        ).join(' | ');
        row["DETALLE DE INCIDENCIAS"] = detalle || '';

        return row;
    });

    // ── Fila de TOTALES ─────────────────────────────────────
    const totRow = { "N°": '', "APELLIDOS Y NOMBRES": '▶ TOTALES', "DNI": '', "SEXO": '' };
    fechas.forEach(f => {
        const colKey = `${DS[f.diaSemana]} ${f.dia}`;
        const esFS = f.diaSemana === 0 || f.diaSemana === 6;
        if (esFS) { totRow[colKey] = ''; return; }
        let cA=0, cT=0, cF=0;
        window.reporteMensualData.forEach(item => {
            const reg = item.diasReg ? item.diasReg[f.fecha] : null;
            if (!reg) { cF++; return; }
            const est = (reg.estado || '').toLowerCase();
            if      (est.includes('tardanza')) cT++;
            else if (est.includes('falta'))    cF++;
            else if (est !== '')               cA++;
            else                               cF++;
        });
        totRow[colKey] = `A:${cA} T:${cT} F:${cF}`;
    });
    const sumA   = window.reporteMensualData.reduce((s,i) => s+(i.asistencias||0), 0);
    const sumT   = window.reporteMensualData.reduce((s,i) => s+(i.tardanzas||0),   0);
    const sumF   = window.reporteMensualData.reduce((s,i) => s+(i.faltas||0),       0);
    const sumJ   = window.reporteMensualData.reduce((s,i) => s+(i.justificados||0), 0);
    const sumInc = window.reporteMensualData.reduce((s,i) => s+(i.incidencias||0),  0);
    totRow["ASIST."]  = sumA;
    totRow["TARD."]   = sumT;
    totRow["FALTAS"]  = sumF;
    totRow["JUSTIF."] = sumJ;
    totRow["INCID."]  = sumInc;
    totRow["DETALLE DE INCIDENCIAS"] = '';
    dataExcel.push(totRow);

    // ── Hoja 2: Detalle completo de incidencias ─────────────
    const incData = [];
    window.reporteMensualData.forEach(item => {
        (item.listadoInc || []).forEach(inc => {
            incData.push({
                "APELLIDOS Y NOMBRES": item.nombres || '',
                "DNI":                 item.dni     || '',
                "FECHA":               inc.fecha,
                "DÍA":                 inc.dia,
                "DÍA SEMANA":          ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][inc.diaSemana],
                "TIPO INCIDENCIA":     inc.label,
                "DESCRIPCIÓN":         inc.valor
            });
        });
    });

    const ws1 = XLSX.utils.json_to_sheet(dataExcel);
    const ws2 = XLSX.utils.json_to_sheet(incData.length > 0 ? incData : [{ "MENSAJE": "No hubo incidencias en este período." }]);
    const wb  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Asistencia Mensual");
    XLSX.utils.book_append_sheet(wb, ws2, "Detalle Incidencias");
    XLSX.writeFile(wb, `Asistencia_Mensual_${mes}.xlsx`);
};

window.descargarReporteMensualPDF = () => {
    if (!window.reporteMensualData || window.reporteMensualData.length === 0) {
        alert("Primero genere un reporte para descargar.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const docPDF = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
    const mes    = window.reporteMensualMes || document.getElementById('mesConsulta').value;
    const fechas = window.reporteMensualFechas || [];
    const DS     = ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'];
    const ME     = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                    'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
    const [year, month] = mes.split('-').map(Number);

    // ── Encabezado institucional ────────────────────────────
    docPDF.setFont("Helvetica", "bold");
    docPDF.setFontSize(13);
    docPDF.setTextColor(21, 128, 61);
    docPDF.text("I.E. HORACIO ZEBALLOS GÁMEZ — MALINGAS", 14, 12);
    docPDF.setFontSize(9);
    docPDF.setTextColor(80);
    docPDF.text(`REGISTRO DE ASISTENCIA MENSUAL | ${ME[month-1]} ${year}`, 14, 18);
    docPDF.text(`(*) = día con incidencia  |  A=Asistió  T=Tardanza  F=Falta  J=Justificado`, 14, 23);

    // ── Columnas encabezado ─────────────────────────────────
    const headCols = ["N°", "APELLIDOS Y NOMBRES", "DNI"];
    fechas.forEach(f => headCols.push(`${DS[f.diaSemana]}\n${f.dia}`));
    headCols.push("A", "T", "F", "J", "INC.");

    // ── Filas de datos ──────────────────────────────────────
    const tableData = window.reporteMensualData.map((item, idx) => {
        const row = [idx + 1, item.nombres || '', item.dni || ''];
        fechas.forEach(f => {
            const esFS = f.diaSemana === 0 || f.diaSemana === 6;
            if (esFS) { row.push(''); return; }
            const reg = item.diasReg ? item.diasReg[f.fecha] : null;
            if (!reg) { row.push('F'); return; }
            const est = (reg.estado || '').toLowerCase();
            let letra = 'A';
            if      (est.includes('justificad'))    letra = 'J';
            else if (est.includes('tardanza'))       letra = 'T';
            else if (est.includes('falta'))          letra = 'F';
            const hasInc = reg.alertaSalud || reg.alertaConducta || reg.alertaCorte || reg.alertaVestimenta;
            row.push(hasInc ? letra + '*' : letra);
        });
        row.push(item.asistencias||0, item.tardanzas||0, item.faltas||0, item.justificados||0, item.incidencias||0);
        return row;
    });

    // ── Fila totales ────────────────────────────────────────
    const totRow = ['', 'TOTALES GENERALES', ''];
    fechas.forEach(f => {
        const esFS = f.diaSemana === 0 || f.diaSemana === 6;
        if (esFS) { totRow.push(''); return; }
        let cA=0,cT=0,cF=0;
        window.reporteMensualData.forEach(item => {
            const reg = item.diasReg ? item.diasReg[f.fecha] : null;
            if (!reg) { cF++; return; }
            const est = (reg.estado||'').toLowerCase();
            if      (est.includes('tardanza')) cT++;
            else if (est.includes('falta'))    cF++;
            else if (est !== '')               cA++;
            else                               cF++;
        });
        totRow.push(`${cA}/${cT}/${cF}`);
    });
    const sumA   = window.reporteMensualData.reduce((s,i)=>s+(i.asistencias||0),0);
    const sumT   = window.reporteMensualData.reduce((s,i)=>s+(i.tardanzas||0),0);
    const sumF   = window.reporteMensualData.reduce((s,i)=>s+(i.faltas||0),0);
    const sumJ   = window.reporteMensualData.reduce((s,i)=>s+(i.justificados||0),0);
    const sumInc = window.reporteMensualData.reduce((s,i)=>s+(i.incidencias||0),0);
    totRow.push(sumA, sumT, sumF, sumJ, sumInc);
    tableData.push(totRow);

    // ── Tabla principal ─────────────────────────────────────
    docPDF.autoTable({
        startY: 27,
        head: [headCols],
        body: tableData,
        theme: 'grid',
        styles:     { fontSize: 5.5, cellPadding: 1, halign: 'center', valign: 'middle', overflow: 'linebreak' },
        headStyles: { fillColor: [21, 128, 61], textColor: 255, fontSize: 5.5, fontStyle: 'bold', halign: 'center' },
        columnStyles: { 0: { cellWidth: 7 }, 1: { cellWidth: 40, halign: 'left' }, 2: { cellWidth: 17 } },
        willDrawCell: (data) => {
            // Colorear última fila (totales)
            if (data.section==='body' && data.row.index===tableData.length-1) {
                data.cell.styles.fillColor = [220, 252, 231];
                data.cell.styles.fontStyle = 'bold';
            }
        },
        didParseCell: (data) => {
            if (data.section !== 'body') return;
            const v = String(data.cell.raw || '');
            if      (v==='F')  { data.cell.styles.fillColor=[254,202,202]; data.cell.styles.textColor=[185,28,28]; }
            else if (v==='F*') { data.cell.styles.fillColor=[254,202,202]; data.cell.styles.textColor=[185,28,28]; data.cell.styles.fontStyle='bold'; }
            else if (v==='T')  { data.cell.styles.fillColor=[254,243,199]; data.cell.styles.textColor=[146,64,14]; }
            else if (v==='T*') { data.cell.styles.fillColor=[254,243,199]; data.cell.styles.textColor=[146,64,14]; data.cell.styles.fontStyle='bold'; }
            else if (v==='A')  { data.cell.styles.fillColor=[220,252,231]; data.cell.styles.textColor=[21,128,61]; }
            else if (v==='A*') { data.cell.styles.fillColor=[220,252,231]; data.cell.styles.textColor=[21,128,61]; data.cell.styles.fontStyle='bold'; }
            else if (v==='J' || v==='J*') { data.cell.styles.fillColor=[219,234,254]; data.cell.styles.textColor=[29,78,216]; }
        }
    });

    // ── PÁGINA 2: Detalle de Incidencias ────────────────────
    const incList = [];
    window.reporteMensualData.forEach(item => {
        (item.listadoInc || []).forEach(inc => {
            incList.push([
                item.nombres || '',
                item.dni || '',
                inc.fecha,
                `${DS[inc.diaSemana]} ${inc.dia}`,
                inc.label,
                inc.valor
            ]);
        });
    });

    if (incList.length > 0) {
        docPDF.addPage();
        docPDF.setFont("Helvetica", "bold");
        docPDF.setFontSize(12);
        docPDF.setTextColor(234, 88, 12);
        docPDF.text("DETALLE DE INCIDENCIAS — " + ME[month-1] + ' ' + year, 14, 14);
        docPDF.setFontSize(8);
        docPDF.setTextColor(100);
        docPDF.text(`Total de incidencias registradas: ${incList.length}`, 14, 20);

        docPDF.autoTable({
            startY: 24,
            head: [['APELLIDOS Y NOMBRES', 'DNI', 'FECHA', 'DÍA', 'TIPO', 'DESCRIPCIÓN']],
            body: incList,
            theme: 'striped',
            styles:     { fontSize: 8, cellPadding: 2 },
            headStyles: { fillColor: [234, 88, 12], textColor: 255, fontStyle: 'bold' },
            columnStyles: {
                0: { cellWidth: 65 },
                1: { cellWidth: 22 },
                2: { cellWidth: 24 },
                3: { cellWidth: 20 },
                4: { cellWidth: 25 },
                5: { cellWidth: 'auto' }
            }
        });
    }

    docPDF.save(`Asistencia_Mensual_${mes}.pdf`);
};
// --- 4. EXPORTACIÓN PDF ---
window.generarReportePDF = async () => {
    const { jsPDF } = window.jspdf;
    const docPDF = new jsPDF();
    const hoyId = new Date().toLocaleDateString('en-CA');
    
    // 1. CARGA MASIVA: Traemos asistencia y alumnos en paralelo para máxima velocidad
    const [snapAsistencia, snapAlumnos] = await Promise.all([
        getDocs(collection(db, "asistencia", hoyId, "registros")),
        getDocs(collection(db, "alumnos"))
    ]);
    
    if(snapAsistencia.empty) return alert("No hay datos para exportar hoy.");

    // 2. MAPEO INSTANTÁNEO: Diccionario de alumnos para evitar 750 getDoc()
    const mapaAlumnos = {};
    snapAlumnos.forEach(docAlu => {
        mapaAlumnos[docAlu.id] = docAlu.data();
    });

    const datosPorGrado = {};

    // 3. PROCESAMIENTO DE DATOS
    snapAsistencia.forEach(d => {
        const dataAsis = d.data();
        const aluInfo = mapaAlumnos[d.id] || {};
        
        // Obtenemos grado y sección desde la base de datos de alumnos
        const gradoSec = aluInfo.grado && aluInfo.seccion 
            ? `${aluInfo.grado}° "${aluInfo.seccion}"`.toUpperCase()
            : "N/A";

        if (!datosPorGrado[gradoSec]) datosPorGrado[gradoSec] = [];
        
        // CONSOLIDACIÓN DE INCIDENCIAS SIN EMOJIS
        const incidencias = [
            dataAsis.alertaSalud || "",
            dataAsis.alertaConducta || "",
            dataAsis.alertaCorte || "",
            dataAsis.alertaVestimenta || "",
            (dataAsis.conductaAlerta || "").replace("⚠️ ", "")
        ].filter(x => x !== "").map(x => x.toUpperCase());

        const todasObservaciones = incidencias.join(", ");

        datosPorGrado[gradoSec].push([
            dataAsis.hora || '--:--', 
            d.id, 
            dataAsis.nombres?.toUpperCase() || "DESCONOCIDO", 
            gradoSec, 
            dataAsis.estado?.toUpperCase() || "FALTÓ",
            todasObservaciones
        ]);
    });

    const grados = Object.keys(datosPorGrado).sort();
    
    // 4. GENERACIÓN DE PÁGINAS DEL PDF
    grados.forEach((grado, index) => {
        if (index > 0) docPDF.addPage();

        // Encabezado Institucional HZG
        docPDF.setTextColor(21, 128, 61); 
        docPDF.setFontSize(16);
        docPDF.setFont("helvetica", "bold");
        docPDF.text("I.E. HORACIO ZEBALLOS GÁMEZ", 14, 20);
        
        docPDF.setFontSize(10);
        docPDF.setTextColor(100);
        docPDF.text(`MALINGAS - TAMBOGRANDE | REPORTE DE ASISTENCIA`, 14, 25);
        
        docPDF.setDrawColor(21, 128, 61);
        docPDF.line(14, 27, 196, 27);

        docPDF.setTextColor(0);
        docPDF.setFontSize(12);
        docPDF.text(`FECHA: ${hoyId}`, 14, 35);
        docPDF.text(`GRADO Y SECCIÓN: ${grado}`, 14, 42);

        // Tabla de datos
        docPDF.autoTable({ 
            startY: 48, 
            head: [['HORA', 'DNI', 'ESTUDIANTE', 'G/S', 'ESTADO', 'OBSERVACIONES']], 
            body: datosPorGrado[grado], 
            headStyles: { fillColor: [21, 128, 61], textColor: [255, 255, 255], fontStyle: 'bold' },
            styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
            columnStyles: {
                2: { cellWidth: 50 }, // Estudiante
                5: { cellWidth: 55, textColor: [180, 0, 0], fontStyle: 'bold' } // Observaciones en rojo
            },
            alternateRowStyles: { fillColor: [240, 253, 244] }
        });
    });

    docPDF.save(`Reporte_HZG_${hoyId}.pdf`);
};

// --- 5. EXPORTACIÓN EXCEL ---
window.generarReporteExcel = async () => {
    const hoyId = new Date().toLocaleDateString('en-CA');
    
    // 1. Obtener todos los datos en paralelo (solo 2 peticiones a Firebase en total)
    const [snapAsistencia, snapAlumnos] = await Promise.all([
        getDocs(collection(db, "asistencia", hoyId, "registros")),
        getDocs(collection(db, "alumnos"))
    ]);
    
    if (snapAsistencia.empty) return alert("No hay datos para exportar hoy.");

    // 2. Crear un mapa de búsqueda instantánea para los nombres de apoderados
    const mapaAlumnos = {};
    snapAlumnos.forEach(docAlu => {
        mapaAlumnos[docAlu.id] = docAlu.data();
    });

    const datosPorGrado = {};

    // 3. Procesar los 750 registros en memoria (esto es instantáneo)
    snapAsistencia.forEach(d => {
        const data = d.data();
        const aluInfo = mapaAlumnos[d.id] || {};
        const gradoSec = `${aluInfo.grado || data.grado || '?'}${aluInfo.seccion || data.seccion || '?'}`.toUpperCase();

        if (!datosPorGrado[gradoSec]) datosPorGrado[gradoSec] = [];
        
        // Consolidación de incidencias
        const incidencias = [
            data.alertaSalud || "",
            data.alertaConducta || "",
            data.alertaCorte || "",
            data.alertaVestimenta || "",
            (data.conductaAlerta || "").replace("⚠️ ", "")
        ].filter(x => x !== "").map(x => x.toUpperCase());

        datosPorGrado[gradoSec].push({
            "HORA": data.hora || '--:--',
            "DNI": d.id,
            "ESTUDIANTE": data.nombres?.toUpperCase() || "DESCONOCIDO",
            "G/S": gradoSec,
            "ESTADO": data.estado?.toUpperCase() || "FALTÓ",
            "OBSERVACIONES": incidencias.join(", ")
        });
    });

    // 4. Crear el libro de Excel
    const wb = XLSX.utils.book_new();
    Object.keys(datosPorGrado).sort().forEach(grado => {
        const ws = XLSX.utils.json_to_sheet(datosPorGrado[grado]);
        
        // Estilos institucionales
        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cell = XLSX.utils.encode_cell({ r: 0, c: C });
            if (!ws[cell]) continue;
            ws[cell].s = {
                fill: { fgColor: { rgb: "15803D" } },
                font: { color: { rgb: "FFFFFF" }, bold: true },
                alignment: { horizontal: "center" }
            };
        }

        ws['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 45 }, { wch: 8 }, { wch: 15 }, { wch: 50 }];
        XLSX.utils.book_append_sheet(wb, ws, `GRADO ${grado}`);
    });

    // 5. Descarga final
    XLSX.writeFile(wb, `Reporte_HZG_${hoyId}.xlsx`);
};

// REEMPLAZO EXACTO: Borra la de UltraMsg y pega esta
const enviarNotificacionUltraMsg = async (telefono, nombre, estado, mensajePersonalizado = null) => {
    // URL: Ahora apunta directamente a la nube de UltraMsg
    const url = "https://api.ultramsg.com/instance169160/messages/chat";
    const token = "bkd2pujvtq9icz2w"; // El token
    
    const mensaje = mensajePersonalizado || `*I.E. HORACIO ZEBALLOS GÁMEZ*\n\nHola, se informa que el estudiante *${nombre.toUpperCase()}* registró su ingreso como: *${estado.toUpperCase()}*.\n\n_Malingas: Disciplina, Lealtad, Honradez._`;

    try {
        await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                token: token,
                to: `51${telefono}`, // UltraMsg usa el parámetro "to"
                body: mensaje        // UltraMsg usa el parámetro "body"
            })
        });
        console.log("✅ Notificación enviada vía UltraMsg a:", nombre);
    } catch (error) {
        console.error("❌ Error al conectar con UltraMsg:", error);
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
                
                /* Configuración de página para 10 carnets (2x5) */
                @page { 
                    size: A4; 
                    margin: 0.8cm 0.5cm; 
                }

                body { 
                    font-family: 'Roboto', sans-serif; 
                    margin: 0; 
                    padding: 0; 
                    background: white;
                }
                
                .contenedor-impresion {
                    display: grid;
                    grid-template-columns: 1fr 1fr; /* 2 columnas */
                    grid-template-rows: repeat(5, 5.4cm); /* 5 filas de tamaño exacto */
                    column-gap: 10px;
                    row-gap: 5px;
                    justify-items: center;
                }

                .carnet { 
                    width: 8.6cm; 
                    height: 5.3cm; /* Ajuste mínimo para que entren los 5 */
                    background: white; 
                    border-radius: 10px; 
                    position: relative; 
                    overflow: hidden; 
                    border: 1px solid #333; 
                    page-break-inside: avoid;
                }

                .cabecera { 
                    background: #15803D; 
                    color: white; 
                    padding: 5px; 
                    text-align: center; 
                    font-size: 10px; 
                    font-weight: 900; 
                }

                .contenido { 
                    display: flex; 
                    padding: 8px 12px; 
                    align-items: center; 
                    height: 3.5cm; 
                }
                
                .logo-img { width: 50px; height: auto; }

                .info-estudiante { 
                    flex: 1; 
                    padding: 0 10px; 
                    display: flex; 
                    flex-direction: column; 
                    justify-content: center; 
                }
                
                .label-est { font-size: 8px; color: #15803D; font-weight: 900; margin-bottom: 1px; }

                .nombre-val { 
                    font-size: 14px; 
                    color: #000; 
                    font-weight: 900; 
                    line-height: 1.1; 
                    margin-bottom: 6px;
                    word-wrap: break-word;
                }

                .datos-contenedor { border-top: 1px solid #eee; padding-top: 4px; }
                .datos-linea { font-size: 11px; font-weight: 900; color: #15803D; margin-top: 2px; }
                .datos-linea span { color: #000; }

                .qr-box { width: 70px; height: 70px; display: flex; justify-content: center; align-items: center; }
                
                .footer { 
                    position: absolute; 
                    bottom: 0; 
                    width: 100%; 
                    background: #f0fdf4; 
                    text-align: center; 
                    font-size: 9px; 
                    color: #15803D; 
                    font-weight: 900; 
                    padding: 4px 0; 
                    border-top: 1px solid #15803D; 
                }

                @media print {
                    body { background: none; }
                    .carnet { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
            </style>
        </head>
        <body>
            <div class="contenedor-impresion">${contenidoCarnets}</div>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
            <script>
                document.querySelectorAll('.qr-code').forEach(div => {
                    new QRCode(div, { 
                        text: div.getAttribute('data-dni'), 
                        width: 70, 
                        height: 70, 
                        correctLevel: QRCode.CorrectLevel.H 
                    });
                });
                setTimeout(() => { 
                    window.print(); 
                    window.close(); 
                }, 1200);
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
        tabla.innerHTML = `<tr><td colspan="6" class="p-10 text-center italic text-slate-400">No hay alumnos para mostrar.</td></tr>`;
        return;
    }

    subsetAlumnos.forEach(a => {
        tabla.innerHTML += `
            <tr class="border-b hover:bg-green-50 transition">
                <td class="p-4 font-mono text-sm text-slate-600">${a.dni}</td>
                <td class="p-4">
                    <div class="font-bold text-slate-700 uppercase">${a.nombres}</div>
                    <div class="text-[10px] text-blue-600 font-bold uppercase">APODERADO: ${a.apoderado || 'SIN REGISTRAR'}</div>
                </td>
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
                        <button onclick="window.editarAlumno('${a.dni}', '${a.nombres}', '${a.grado}', '${a.seccion}', '${a.telefono}', '${a.apoderado || ""}')" 
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
window.editarAlumno = (dni, nombres, grado, seccion, telefono, apoderado) => {
    document.getElementById('dni').value = dni;
    document.getElementById('nombres').value = nombres;
    document.getElementById('grado').value = grado;
    document.getElementById('seccion').value = seccion;
    document.getElementById('telefono').value = telefono;
    
    // Asignar el valor al nuevo campo del apoderado
    if (document.getElementById('apoderado')) {
        document.getElementById('apoderado').value = apoderado || "";
    }
    
    window.mostrarSeccion('registro');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.eliminarAlumno = async (id) => { if(confirm("¿Eliminar?")) await deleteDoc(doc(db, "alumnos", id)); };

// --- 3. JUSTIFICAR Y CONDUCTA (Sincronizado con el modelo de la App) ---
window.justificarFalta = async (dni, nombre) => {
    const n = prompt(`Cambiar estado para ${nombre.toUpperCase()}:\n1. Puntual\n2. Tardanza\n3. Salida por Salud\n4. Tardanza Justificada\n5. Falta Justificada\n6. Falta\n7. Indisciplina\n8. Vestimenta Inadecuada\n9. Corte Inadecuado`, "1");
    
    const ahora = new Date();
    const horaActual = ahora.toLocaleTimeString('es-PE', { hour12: false });
    const hoy = document.getElementById('fechaConsulta')?.value || ahora.toLocaleDateString('en-CA');

    try {
        const docAlu = await getDoc(doc(db, "alumnos", dni));
        if (!docAlu.exists()) return alert("Alumno no encontrado.");
        
        const datosAlumno = docAlu.data();
        const telefono = datosAlumno.telefono;
        const nombreApoderado = datosAlumno.apoderado ? datosAlumno.apoderado.toUpperCase() : "APODERADO";

        let updates = {};
        let mensajeWhatsApp = "";
        let esIncidencia = false;

        switch (n) {
            case "1": case "2": case "4": case "5": case "6":
                const estados = ["", "Puntual", "Tardanza", "", "Tardanza Justificada", "Falta Justificada", "Falta"];
                updates = { estado: estados[n] };
                mensajeWhatsApp = `*CONTROL DE ASISTENCIA HZG*\n\nEstimado(a) *${nombreApoderado}*,\nEstudiante: *${nombre.toUpperCase()}*\nEstado Actualizado: *${updates.estado.toUpperCase()}*\nHora: ${horaActual}\n\n_Malingas: Disciplina, Lealtad, Honradez._`;
                break;

            case "3": // SALIDA POR SALUD
                updates = { alertaSalud: `SALIDA SALUD (${horaActual})` };
                mensajeWhatsApp = `*REPORTE MÉDICO - I.E. HZG*\n\nEstimado(a) *${nombreApoderado}*,\nSe informa que el estudiante *${nombre.toUpperCase()}* se retira por motivos de SALUD.\nHora: ${horaActual}\n\n_Malingas: Disciplina, Lealtad, Honradez._`;
                break;

            case "7": // INDISCIPLINA
                updates = { alertaConducta: `CONDUCTA INADECUADA (${horaActual})` };
                esIncidencia = true;
                mensajeWhatsApp = `*REPORTE DE CONDUCTA - I.E. HZG*\n\nEstimado(a) *${nombreApoderado}*,\nse le informa que el estudiante *${nombre.toUpperCase()}* ha presentado una *CONDUCTA INADECUADA*.\nHora: ${horaActual}\n\nSe estara coordinando para que se acerque a la institución educativa.\n\n_Disciplina, Lealtad, Honradez._`;
                break;

            case "8": // VESTIMENTA
                updates = { alertaVestimenta: `VESTIMENTA INADECUADA (${horaActual})` };
                mensajeWhatsApp = `*REPORTE DE VESTIMENTA - I.E. HZG*\n\nEstimado(a) *${nombreApoderado}*,\nse le informa que el estudiante *${nombre.toUpperCase()}* registra: *VESTIMENTA INADECUADA*.\nHora: ${horaActual}\n\n_Malingas: Disciplina, Lealtad, Honradez._`;
                break;

            case "9": // CORTE
                updates = { alertaCorte: `CORTE INADECUADO (${horaActual})` };
                mensajeWhatsApp = `*REPORTE DE PRESENTACIÓN - I.E. HZG*\n\nEstimado(a) *${nombreApoderado}*,\nse le informa que el estudiante *${nombre.toUpperCase()}* registra: *CORTE DE CABELLO INADECUADO*.\nHora: ${horaActual}\n\n_Malingas: Disciplina, Lealtad, Honradez._`;
                break;

            default: return;
        }

        // Si es indisciplina (7), también guardamos en el historial de conducta del alumno
        if (n === "7") {
            const idConducta = Date.now().toString();
            await setDoc(doc(db, "alumnos", dni, "conducta", idConducta), {
                fecha: hoy, hora: horaActual, incidencia: "Conducta Inadecuada", nombres: nombre.toUpperCase()
            });
        }

        // Actualizamos en la lista de asistencia de hoy (usando merge para no chancar otros datos)
        await setDoc(doc(db, "asistencia", hoy, "registros", dni), updates, { merge: true });
        
        // Enviamos notificación
        if (telefono && mensajeWhatsApp) {
            await window.enviarNotificacionUltraMsg(telefono, mensajeWhatsApp);
        }
        
        alert("✅ Registro actualizado y notificado al apoderado.");

    } catch (e) { 
        console.error(e); 
        alert("Error al procesar la solicitud."); 
    }
};

// NUEVA FUNCIÓN PARA TU BOT PROPIO (Node.js)
window.enviarNotificacionUltraMsg = async (telefono, nombre, estado, mensajePersonalizado) => {
    try {
        // Aseguramos que el mensaje enviado incluya el nombre o el texto necesario
        const mensajeFinal = mensajePersonalizado || `Hola, ${nombre}. Su estado de asistencia ha sido actualizado.`;

        const response = await fetch(NUEVA_API_URL, {
            method: 'POST',
            // Dependiendo de si tu servidor espera JSON o formulario (x-www-form-urlencoded)
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                phone: telefono,
                message: mensajeFinal
            })
        });

        // Verificamos si la respuesta es correcta
        if (!response.ok) {
            throw new Error(`Error en el servidor HTTP: ${response.status}`);
        }

        console.log("✅ Mensaje enviado correctamente mediante la nueva API.");
    } catch (e) {
        console.error("❌ Error al enviar mensaje mediante la nueva API:", e);
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