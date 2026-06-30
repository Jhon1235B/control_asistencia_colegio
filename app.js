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

/* ════════════════════════════════════════════════════════════════
   OPTIMIZACIÓN DE LECTURAS FIREBASE (caché de reportes)
   - Alumnos: se leen 1 sola vez por sesión y se reutilizan.
   - Asistencia de meses ya cerrados: se guarda en IndexedDB y
     las siguientes veces se lee del navegador (0 lecturas Firebase).
   ════════════════════════════════════════════════════════════════ */

// ── Caché en memoria del padrón de alumnos ──────────────────────
window.__cacheAlumnos = null; // { dni: {datos...} }

async function cargarAlumnosEnMemoria() {
    if (window.__cacheAlumnos && Object.keys(window.__cacheAlumnos).length) {
        return window.__cacheAlumnos;            // ya está en memoria → 0 lecturas
    }
    const snap = await getDocs(collection(db, "alumnos"));
    const mapa = {};
    snap.forEach(d => { mapa[d.id] = d.data(); });
    window.__cacheAlumnos = mapa;
    return mapa;
}
// Llamar a esto cada vez que se agrega o elimina un alumno
window.invalidarCacheAlumnos = () => { window.__cacheAlumnos = null; };

// ── Caché en IndexedDB de la asistencia mensual ─────────────────
const IDB_NAME = 'reportesIE', IDB_STORE = 'asistenciaMensual', IDB_VER = 1;

function idbAbrir() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, IDB_VER);
        req.onupgradeneeded = e => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains(IDB_STORE)) d.createObjectStore(IDB_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}
async function idbLeer(clave) {
    try {
        const d = await idbAbrir();
        return await new Promise((resolve, reject) => {
            const r = d.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(clave);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror   = () => reject(r.error);
        });
    } catch (e) { return null; }
}
async function idbGuardar(clave, valor) {
    try {
        const d = await idbAbrir();
        return await new Promise((resolve, reject) => {
            const r = d.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(valor, clave);
            r.onsuccess = () => resolve(true);
            r.onerror   = () => reject(r.error);
        });
    } catch (e) { return false; }
}
// Borra toda la caché de reportes (útil si se corrige un mes pasado)
window.limpiarCacheReportes = async () => {
    try {
        const d = await idbAbrir();
        await new Promise((resolve, reject) => {
            const r = d.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).clear();
            r.onsuccess = () => resolve(true);
            r.onerror   = () => reject(r.error);
        });
        window.__cacheAlumnos = null;
        alert("Caché de reportes borrada. El próximo reporte se leerá de nuevo desde Firebase.");
    } catch (e) { alert("No se pudo borrar la caché: " + e.message); }
};


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
                window.invalidarCacheAlumnos();
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
    
   // La asistencia se carga solo cuando el usuario navega a esa sección
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
    const fecha = nuevaFecha || new Date().toLocaleDateString('en-CA');
    const input = document.getElementById('fechaConsulta');
    if (input) input.value = fecha;
    _tabActiva = null;
    iniciarControlAsistencia(fecha);
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
// Estado de pestañas
let _asistenciaRegistros = [];
let _tabActiva = null;

const iniciarControlAsistencia = (fechaManual = null) => {
    const hoy = fechaManual || new Date().toLocaleDateString('en-CA');
    const contenedorAsis = document.getElementById('asistenciaHoy');
    if (!contenedorAsis) return;

    onSnapshot(collection(db, "asistencia", hoy, "registros"), (snapshot) => {
        contenedorAsis.innerHTML = "";

        if (snapshot.empty) {
            const t = document.getElementById('tabsGrados');
            if (t) t.innerHTML = '';
            contenedorAsis.innerHTML = `<div class="p-10 text-center text-slate-400 italic border-2 border-dashed rounded-xl">
                No hay alumnos registrados para esta fecha (${hoy})...
            </div>`;
            return;
        }

        _asistenciaRegistros = snapshot.docs.map(docSnap => {
            const d = docSnap.data();
            return {
                ...d,
                dni: docSnap.id,
                aula: `${d.grado || '?'}° "${d.seccion || '?'}"`.toUpperCase()
            };
        });

        // Agrupar por aula y ordenar
        const grupos = _asistenciaRegistros.reduce((acc, curr) => {
            if (!acc[curr.aula]) acc[curr.aula] = [];
            acc[curr.aula].push(curr);
            return acc;
        }, {});
        const aulasOrdenadas = Object.keys(grupos).sort();

        // Si no hay tab activa o la activa ya no existe, usar la primera
        if (!_tabActiva || !grupos[_tabActiva]) _tabActiva = aulasOrdenadas[0];

       // Guardar aulas en variable global para acceder por índice
        window._aulasAsistencia = aulasOrdenadas;

        const tabsContainer = document.getElementById('tabsGrados');
        tabsContainer.innerHTML = aulasOrdenadas.map((aula, idx) => `
            <button onclick="window.cambiarTabAsistencia(window._aulasAsistencia[${idx}])"
                id="tab_${idx}"
                class="tab-aula px-3 py-1.5 rounded-lg text-xs font-black uppercase border-2 transition
                    ${aula === _tabActiva
                        ? 'bg-green-700 text-white border-green-700'
                        : 'bg-white text-green-700 border-green-200 hover:border-green-500'}">
                ${aula} <span class="ml-1 opacity-75">(${grupos[aula].length})</span>
            </button>`).join('');

        // Renderizar tabla de la pestaña activa
        window._renderTablaAsistencia(grupos, _tabActiva, hoy);
    });
};

window.cambiarTabAsistencia = (aula) => {
    _tabActiva = aula;
    // Actualizar estilos de pestañas
    const aulas = window._aulasAsistencia || [];
    document.querySelectorAll('.tab-aula').forEach((btn, idx) => {
        const esActiva = aulas[idx] === aula;
        btn.className = `tab-aula px-3 py-1.5 rounded-lg text-xs font-black uppercase border-2 transition
            ${esActiva ? 'bg-green-700 text-white border-green-700' : 'bg-white text-green-700 border-green-200 hover:border-green-500'}`;
    });
    // Re-agrupar y renderizar
    const grupos = _asistenciaRegistros.reduce((acc, curr) => {
        if (!acc[curr.aula]) acc[curr.aula] = [];
        acc[curr.aula].push(curr);
        return acc;
    }, {});
    window._renderTablaAsistencia(grupos, aula, document.getElementById('fechaConsulta')?.value || new Date().toLocaleDateString('en-CA'));
};

window.filtrarAsistencia = () => {
    const texto = document.getElementById('buscadorAsistencia')?.value.toLowerCase().trim() || '';
    const grupos = _asistenciaRegistros.reduce((acc, curr) => {
        if (!acc[curr.aula]) acc[curr.aula] = [];
        acc[curr.aula].push(curr);
        return acc;
    }, {});
    const hoy = document.getElementById('fechaConsulta')?.value || new Date().toLocaleDateString('en-CA');

    if (!texto) {
        window._renderTablaAsistencia(grupos, _tabActiva, hoy);
        return;
    }

    // Al buscar, mostrar resultados de TODOS los grados sin filtrar por tab
    const filtrados = _asistenciaRegistros.filter(r =>
        (r.nombres || '').toLowerCase().includes(texto) ||
        (r.dni || '').includes(texto)
    );
    window._renderTablaConResultados(filtrados, hoy);
};

window._renderTablaAsistencia = (grupos, aula, hoy) => {
    const contenedorAsis = document.getElementById('asistenciaHoy');
    contenedorAsis.innerHTML = '';
    const lista = grupos[aula] || [];
    contenedorAsis.appendChild(window._crearTablaAula(aula, lista, hoy));
};

window._renderTablaConResultados = (lista, hoy) => {
    const contenedorAsis = document.getElementById('asistenciaHoy');
    contenedorAsis.innerHTML = '';
    if (lista.length === 0) {
        contenedorAsis.innerHTML = `<div class="p-8 text-center text-slate-400 italic border-2 border-dashed rounded-xl">No se encontraron resultados.</div>`;
        return;
    }
    contenedorAsis.appendChild(window._crearTablaAula('Resultados de búsqueda', lista, hoy));
};

window._crearTablaAula = (titulo, lista, hoy) => {
    const div = document.createElement('div');
    div.className = "overflow-hidden rounded-xl border border-slate-200 shadow-sm";
    div.innerHTML = `
        <div class="bg-slate-50 border-b border-slate-200 px-4 py-2 flex justify-between items-center">
            <h3 class="font-black text-green-800 text-sm">SECCION: ${titulo}</h3>
            <span class="bg-green-600 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">${lista.length} REGISTROS</span>
        </div>
        <table class="w-full text-left border-collapse">
            <tbody class="bg-white">
                ${lista.map(reg => {
                    const color = reg.estado === "Puntual"       ? "bg-green-100 text-green-700" :
                                  reg.estado === "Tardanza"      ? "bg-yellow-100 text-yellow-700" :
                                  reg.estado?.includes("Justificada") ? "bg-blue-100 text-blue-700" :
                                  "bg-red-100 text-red-700";
                    return `
                    <tr class="border-b last:border-0 hover:bg-slate-50 transition">
                        <td class="p-3 font-bold text-green-700 w-20 text-sm">${reg.hora || '--:--'}</td>
                        <td class="p-3">
                            <div class="font-bold text-slate-700 text-sm">${reg.nombres}</div>
                            <div class="text-[9px] text-slate-400 font-bold uppercase">DNI: ${reg.dni}</div>
                            ${reg.apoderado ? `<div class="text-[9px] text-blue-600 font-bold uppercase">APODERADO: ${reg.apoderado}</div>` : ''}
                        </td>
                        <td class="p-3">
                            <div class="flex flex-col gap-1 items-start">
                                <span class="px-2 py-0.5 rounded-full text-[9px] font-black ${color}">
                                    ${reg.estado?.toUpperCase() || 'FALTÓ'}
                                </span>
                                <div class="flex flex-wrap gap-1 mt-1">
                                    ${reg.alertaSalud    ? `<span class="bg-blue-600 text-white px-2 py-0.5 rounded text-[8px] font-bold uppercase">${reg.alertaSalud}</span>` : ''}
                                    ${reg.alertaConducta ? `<span class="bg-red-500 text-white px-2 py-0.5 rounded text-[8px] font-bold uppercase">${reg.alertaConducta}</span>` : ''}
                                    ${(reg.alertaVestimenta || reg.alertaCorte) ? `<span class="bg-orange-500 text-white px-2 py-0.5 rounded text-[8px] font-bold uppercase">${reg.alertaVestimenta || reg.alertaCorte}</span>` : ''}
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
    return div;
};

// Función auxiliar para dar un respiro a la API
const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- DESCARGAR PLANTILLA EXCEL PARA CARGA MASIVA ---
window.descargarPlantillaMasiva = () => {
    const encabezados = [["DNI", "NOMBRE_ESTUDIANTE", "GRADO", "SECCION", "NOMBRE_APODERADO", "TELEFONO_APODERADO"]];
    const ws = XLSX.utils.aoa_to_sheet(encabezados);

    // Estilo del encabezado
    const cols = ["A1","B1","C1","D1","E1","F1"];
    cols.forEach(celda => {
        if (!ws[celda]) return;
        ws[celda].s = {
            fill: { fgColor: { rgb: "15803D" } },
            font: { color: { rgb: "FFFFFF" }, bold: true },
            alignment: { horizontal: "center" }
        };
    });
    ws['!cols'] = [
        { wch: 12 }, { wch: 35 }, { wch: 8 },
        { wch: 10 }, { wch: 35 }, { wch: 18 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Alumnos");
    XLSX.writeFile(wb, "Plantilla_Carga_Masiva_Alumnos.xlsx");
};

window.escanearYRegistrarMasivo = async () => {
    const fileInput = document.getElementById('fotoMasiva');
    const log = document.getElementById('logRegistro');
    const btn = document.getElementById('btnMasivo');

    const archivo = fileInput.files[0];
    if (!archivo) return alert("Selecciona un archivo Excel.");

    log.classList.remove('hidden');
    log.innerHTML = `🚀 Iniciando procesamiento masivo institucional...<br>`;
    btn.disabled = true;

    try {
        let estudiantesParaProcesar = [];

        if (!archivo.name.endsWith('.xlsx') && !archivo.name.endsWith('.xls')) {
            return alert("Por favor use archivos Excel (.xlsx o .xls).");
        }

        const data = await archivo.arrayBuffer();
        const libro = XLSX.read(data, { type: 'array' });
        const hoja = libro.Sheets[libro.SheetNames[0]];

        // Leer con encabezados automáticos (primera fila = nombres de columna)
        const filasJson = XLSX.utils.sheet_to_json(hoja, { defval: "" });

        log.innerHTML += "📊 Leyendo columnas del Excel...<br>";

        // Normalizar nombres de columna (mayúsculas, sin espacios extra)
        const normalizar = (str) => String(str).trim().toUpperCase().replace(/\s+/g, '_');

        estudiantesParaProcesar = filasJson.map(fila => {
            // Crear objeto con claves normalizadas
            const f = {};
            Object.keys(fila).forEach(k => { f[normalizar(k)] = String(fila[k]).trim(); });

            // Mapeo flexible de columnas
            const dni          = f['DNI'] || f['D.N.I'] || f['DOCUMENTO'] || '';
            const nombre       = f['NOMBRE_ESTUDIANTE'] || f['NOMBRES'] || f['NOMBRE'] || f['ALUMNO'] || f['ESTUDIANTE'] || '';
            const grado        = f['GRADO'] || f['GRADE'] || '';
            const seccion      = f['SECCION'] || f['SECCIÓN'] || f['SECTION'] || '';
            const apoderado    = f['NOMBRE_APODERADO'] || f['APODERADO'] || f['PADRE'] || f['TUTOR'] || '';
            const telefono     = f['TELEFONO_APODERADO'] || f['TELEFONO'] || f['TELÉFONO'] || f['CELULAR'] || f['WHATSAPP'] || '';

            return { dni, nombre, grado, seccion, apoderado, telefono };
        }).filter(est => /^\d{8}$/.test(est.dni)); // Solo filas con DNI válido de 8 dígitos

        if (estudiantesParaProcesar.length === 0) {
            log.innerHTML += `<span class="text-yellow-400">⚠️ No se encontraron filas con DNI válido (8 dígitos).<br>Asegúrate que la primera fila del Excel tenga los encabezados correctos.</span>`;
            btn.disabled = false;
            return;
        }

        const total = estudiantesParaProcesar.length;
        log.innerHTML += `✅ <b>Total identificado: ${total} alumnos.</b><hr class='border-slate-700 my-2'>`;

        for (let i = 0; i < total; i++) {
            const est = estudiantesParaProcesar[i];
            const numActual = i + 1;

            log.innerHTML += `<span class="text-blue-400">[${numActual}/${total}]</span> 🔍 DNI: ${est.dni} — ${est.nombre || 'Sin nombre'} ... `;

            let nombreFinal = est.nombre || "PENDIENTE";

            // Si no vino nombre en el Excel, intentar API RENIEC
            if (!est.nombre) {
                try {
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
            }

            // GUARDADO EN FIREBASE con todos los campos
            await setDoc(doc(db, "alumnos", est.dni), {
                dni:       est.dni,
                nombres:   nombreFinal.toUpperCase(),
                grado:     est.grado,
                seccion:   est.seccion.toUpperCase(),
                apoderado: est.apoderado.toUpperCase(),
                telefono:  est.telefono,
                fechaRegistro: new Date().toLocaleDateString()
            }, { merge: true });

            log.innerHTML += `<span class="text-green-400">OK ✅</span><br>`;
            log.scrollTop = log.scrollHeight;
        }

        log.innerHTML += `<br><span class="text-yellow-300 font-bold">🎉 Proceso completado: ${total} alumnos registrados.</span>`;
        window.invalidarCacheAlumnos();
        alert(`✅ Éxito. Se registraron ${total} alumnos.`);
        if (typeof window.cargarBloques === 'function') await window.cargarBloques();

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
                    <div class="cabecera">I.E. HORACIO ZEVALLOS GÁMEZ - MALINGAS</div>
                    
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
    { campo: 'alertaConducta',  emoji: '', label: 'Conducta/Infraccion' },
    { campo: 'alertaVestimenta',emoji: '', label: 'Present. Personal'   },
    { campo: 'alertaCorte',     emoji: '', label: 'Present. Personal'   },
    { campo: 'alertaSalud',     emoji: '', label: 'Salida/Permiso'      },
];

/** Devuelve el aula (grado + sección) de un alumno, ej: 3° "B" */
function aulaDeAlumno(alu) {
    const g = String(alu.grado   || '').trim();
    const s = String(alu.seccion || '').trim().toUpperCase();
    if (!g && !s) return 'SIN AULA';
    return `${g || '?'}° "${s || '?'}"`;
}

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

        // ── Cargar alumnos (desde memoria → 0 lecturas tras la 1ª vez) ─
        const padron = await cargarAlumnosEnMemoria();
        const alumnos = {};
        Object.entries(padron).forEach(([id, d]) => {
            const gr  = String(d.grado   || '').trim();
            const sec = String(d.seccion || '').trim().toUpperCase();
            if (filtroGrado && gr  !== filtroGrado)              return;
            if (filtroSec   && sec !== filtroSec.toUpperCase())  return;
            alumnos[id] = {
                ...d, dni: id,
                diasReg: {},       // fecha → datos del registro
                listadoInc: [],    // [{ fecha, diaSemana, emoji, label, valor }]
                listadoTard: [],   // [{ fecha, dia, diaSemana, hora }]
                asistencias: 0, tardanzas: 0, faltas: 0, justificados: 0, incidencias: 0
            };
        });

        // ── Cargar asistencia del mes (con caché de meses cerrados) ─
        // Solo días hábiles: los fines de semana no tienen registros.
        const diasHabiles = fechas.filter(f => f.diaSemana !== 0 && f.diaSemana !== 6);
        const mesActualYM  = new Date().toISOString().slice(0, 7); // "2026-06"
        const mesCerrado   = mes < mesActualYM;  // un mes pasado ya no cambia
        const claveCache   = `asist_${mes}`;

        let regsPorFecha = null;
        if (mesCerrado) regsPorFecha = await idbLeer(claveCache); // intenta caché

        if (!regsPorFecha) {
            // No hay caché → leer de Firebase en lotes
            regsPorFecha = {};
            const LOTE = 7;
            for (let i = 0; i < diasHabiles.length; i += LOTE) {
                const lote = diasHabiles.slice(i, i + LOTE);
                const snaps = await Promise.all(
                    lote.map(f => getDocs(collection(db, "asistencia", f.fecha, "registros")))
                );
                snaps.forEach((snap, si) => {
                    const dia = {};
                    snap.forEach(docReg => { dia[docReg.id] = docReg.data(); });
                    regsPorFecha[lote[si].fecha] = dia;
                });
            }
            // Guardar en IndexedDB solo si el mes ya cerró (no cambiará)
            if (mesCerrado) await idbGuardar(claveCache, regsPorFecha);
        }

        // ── Aplicar los registros a cada alumno ─────────────
        diasHabiles.forEach(fInfo => {
            const dia = regsPorFecha[fInfo.fecha];
            if (!dia) return;
            Object.entries(dia).forEach(([dni, data]) => {
                if (!alumnos[dni]) return;
                alumnos[dni].diasReg[fInfo.fecha] = data;

                // Incidencias con detalle (los contadores A/T/F/J se recalculan más abajo)
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


        // ── Detectar FERIADOS: días hábiles sin ningún registro ─
        const feriadosSet = new Set();
        fechas.forEach(f => {
            if (f.diaSemana === 0 || f.diaSemana === 6) return; // fines de semana ya ignorados
            const tieneRegistros = Object.values(alumnos).some(a => a.diasReg[f.fecha]);
            if (!tieneRegistros) feriadosSet.add(f.fecha);
        });

        // ── Recalcular contadores de cada alumno excluyendo feriados ─
        Object.values(alumnos).forEach(alu => {
            // Resetear contadores
            alu.asistencias = 0; alu.tardanzas = 0; alu.faltas = 0; alu.justificados = 0;
            alu.listadoTard = [];
            fechas.forEach(f => {
                if (f.diaSemana === 0 || f.diaSemana === 6) return; // fin de semana
                if (feriadosSet.has(f.fecha)) return;               // feriado → no cuenta
                const data = alu.diasReg[f.fecha];
                if (!data) { alu.faltas++; return; }                // día hábil sin registro = falta
                const est = (data.estado || '').toLowerCase();
                if      (est.includes('justificad'))  alu.justificados++;
                if      (est.includes('tardanza'))    {
                    alu.tardanzas++; alu.asistencias++;
                    alu.listadoTard.push({
                        fecha:     f.fecha,
                        dia:       f.dia,
                        diaSemana: f.diaSemana,
                        hora:      data.hora || '',
                        estado:    data.estado || 'Tardanza'
                    });
                }
                else if (est.includes('falta') && !est.includes('justificad')) alu.faltas++;
                else if (est !== '')                  alu.asistencias++;
                else                                  alu.faltas++;
            });
        });

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
        window.reporteMensualFeriados = feriadosSet;

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
                const esFeriado = feriadosSet.has(f.fecha);
                const bgDia = f.diaSemana === 0 ? '#7f1d1d'
                            : f.diaSemana === 6 ? '#14532d'
                            : esFeriado         ? '#6b21a8'   // morado = feriado
                            : '#15803d';
                const labelExtra = esFeriado ? `<div style="font-size:7px;font-weight:900;color:#e9d5ff;line-height:1;">FER</div>` : '';
                thHTML += `<th style="min-width:26px;max-width:26px;background:${bgDia};border:1px solid #166534;padding:3px 1px;text-align:center;vertical-align:bottom;">
                    <div style="font-size:8px;font-weight:900;color:#fff;line-height:1.1;">${DIAS_SEMANA_CORTO[f.diaSemana]}</div>
                    <div style="font-size:10px;font-weight:900;color:#fff;line-height:1.2;">${f.dia}</div>
                    ${labelExtra}
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
                const esFeriado   = feriadosSet.has(f.fecha);

                if (esFinSemana) {
                    celdas += `<td style="background:#e2e8f0;min-width:26px;max-width:26px;border:1px solid #cbd5e1;"></td>`;
                } else if (esFeriado) {
                    // Día sin actividad = feriado/no laborable → NO cuenta como falta
                    celdas += `<td title="Feriado / Día no laborable" style="min-width:26px;max-width:26px;padding:2px 1px;text-align:center;border:1px solid #e2e8f0;vertical-align:middle;">
                        <div style="display:inline-flex;flex-direction:column;align-items:center;">
                            <span style="display:inline-block;width:20px;height:20px;border-radius:3px;background:#7c3aed;color:#fff;font-size:7px;font-weight:900;line-height:20px;text-align:center;">FER</span>
                        </div>
                    </td>`;
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
                        <span style="font-size:9px;font-weight:900;color:#ea580c;text-transform:uppercase;">⚠ INCIDENCIAS — ${alu.nombres} <span style="color:#9a3412;background:#ffedd5;border-radius:3px;padding:0 4px;margin-left:2px;">AULA: ${aulaDeAlumno(alu)}</span></span>
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
                        ${alu.listadoInc.map((i, n) =>
                            `<span style="font-size:9px;color:#7c2d12;font-weight:700;"><b>${n+1}.</b> ${i.emoji} <b>${i.label}</b> (día ${i.dia}): ${i.valor}</span><br>`
                        ).join('')}
                    </div>
                </td>`;

                trInc.innerHTML = incCeldas;
                fragment.appendChild(trInc);
            }

            // ── Fila de TARDANZAS detalladas ───────────────
            if (alu.listadoTard && alu.listadoTard.length > 0) {
                const trTard = document.createElement('tr');
                trTard.style.cssText = `background:#fffbeb;`;

                // Agrupar tardanzas: fecha → lista
                const tardPorDia = {};
                alu.listadoTard.forEach(t => {
                    if (!tardPorDia[t.fecha]) tardPorDia[t.fecha] = [];
                    tardPorDia[t.fecha].push(t);
                });

                let tardCeldas = `
                    <td colspan="2" style="position:sticky;left:0;z-index:10;background:#fffbeb;padding:3px 6px;border:1px solid #fde68a;border-left:3px solid #f59e0b;">
                        <span style="font-size:9px;font-weight:900;color:#b45309;text-transform:uppercase;">⏱ TARDANZAS — ${alu.nombres} <span style="color:#92400e;background:#fef3c7;border-radius:3px;padding:0 4px;margin-left:2px;">AULA: ${aulaDeAlumno(alu)}</span></span>
                    </td>
                    <td style="background:#fffbeb;border:1px solid #fde68a;"></td>
                    <td style="background:#fffbeb;border:1px solid #fde68a;"></td>`;

                fechas.forEach(f => {
                    const tards = tardPorDia[f.fecha];
                    if (!tards || tards.length === 0) {
                        tardCeldas += `<td style="background:#fffbeb;border:1px solid #fde68a;min-width:26px;max-width:26px;"></td>`;
                    } else {
                        const tags = tards.map(t =>
                            `<span title="${t.estado}${t.hora?' ('+t.hora+')':''}" style="display:inline-block;background:#f59e0b;color:#fff;border-radius:3px;padding:0 3px;font-size:8px;font-weight:900;line-height:14px;margin:1px;">${t.hora || 'T'}</span>`
                        ).join('');
                        tardCeldas += `<td style="background:#fffbeb;border:1px solid #fde68a;min-width:26px;max-width:26px;padding:2px;text-align:center;vertical-align:middle;">${tags}</td>`;
                    }
                });

                tardCeldas += `<td style="background:#fffbeb;border:1px solid #fde68a;" colspan="5">
                    <div style="padding:2px 6px;">
                        ${alu.listadoTard.map((t, n) =>
                            `<span style="font-size:9px;color:#78350f;font-weight:700;"><b>${n+1}.</b> ⏱ <b>Día ${t.dia}</b>${t.hora?' ('+t.hora+')':''}: ${t.estado}</span><br>`
                        ).join('')}
                    </div>
                </td>`;

                trTard.innerHTML = tardCeldas;
                fragment.appendChild(trTard);
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
            const esFeriado   = feriadosSet.has(f.fecha);
            if (esFinSemana) {
                totCeldas += `<td style="background:#e2e8f0;min-width:26px;max-width:26px;border:1px solid #cbd5e1;"></td>`;
            } else if (esFeriado) {
                totCeldas += `<td title="Feriado" style="min-width:26px;max-width:26px;padding:2px 1px;text-align:center;border:1px solid #e2e8f0;background:#f3e8ff;">
                    <span style="font-size:7px;font-weight:900;color:#7c3aed;">FER</span>
                </td>`;
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
            const esFeriado = window.reporteMensualFeriados && window.reporteMensualFeriados.has(f.fecha);
            if (esFeriado)  { row[colKey] = 'FER'; return; }
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
    const feriadosExcel = window.reporteMensualFeriados || new Set();
    fechas.forEach(f => {
        const colKey = `${DS[f.diaSemana]} ${f.dia}`;
        const esFS = f.diaSemana === 0 || f.diaSemana === 6;
        if (esFS) { totRow[colKey] = ''; return; }
        if (feriadosExcel.has(f.fecha)) { totRow[colKey] = 'FER'; return; } // feriado: no cuenta
        let cA=0, cT=0, cF=0;
        window.reporteMensualData.forEach(item => {
            const reg = item.diasReg ? item.diasReg[f.fecha] : null;
            const l = getEstadoCelda(reg).letra; // misma clasificación que la tabla
            if      (l === 'A') cA++;
            else if (l === 'T') cT++;
            else if (l === 'F') cF++;
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
    let nInc = 0;
    window.reporteMensualData.forEach(item => {
        (item.listadoInc || []).forEach(inc => {
            incData.push({
                "N°":                  ++nInc,
                "APELLIDOS Y NOMBRES": item.nombres || '',
                "AULA":                aulaDeAlumno(item),
                "DNI":                 item.dni     || '',
                "FECHA":               inc.fecha,
                "DÍA":                 inc.dia,
                "DÍA SEMANA":          ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][inc.diaSemana],
                "TIPO INCIDENCIA":     inc.label,
                "DESCRIPCIÓN":         inc.valor
            });
        });
    });

    // ── Hoja 3: Detalle completo de tardanzas ───────────────
    const tardData = [];
    let nTard = 0;
    window.reporteMensualData.forEach(item => {
        (item.listadoTard || []).forEach(t => {
            tardData.push({
                "N°":                  ++nTard,
                "APELLIDOS Y NOMBRES": item.nombres || '',
                "AULA":                aulaDeAlumno(item),
                "DNI":                 item.dni     || '',
                "FECHA":               t.fecha,
                "DÍA":                 t.dia,
                "DÍA SEMANA":          ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][t.diaSemana],
                "HORA":                t.hora || '',
                "ESTADO":              t.estado || 'Tardanza'
            });
        });
    });

    const ws1 = XLSX.utils.json_to_sheet(dataExcel);
    const ws2 = XLSX.utils.json_to_sheet(incData.length > 0 ? incData : [{ "MENSAJE": "No hubo incidencias en este período." }]);
    const ws3 = XLSX.utils.json_to_sheet(tardData.length > 0 ? tardData : [{ "MENSAJE": "No hubo tardanzas en este período." }]);
    const wb  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Asistencia Mensual");
    XLSX.utils.book_append_sheet(wb, ws2, "Detalle Incidencias");
    XLSX.utils.book_append_sheet(wb, ws3, "Detalle Tardanzas");
    XLSX.writeFile(wb, `Asistencia_Mensual_${mes}.xlsx`);
};

window.descargarReporteMensualPDF = () => {
    if (!window.reporteMensualData || window.reporteMensualData.length === 0) {
        alert("Primero genere un reporte para descargar.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const docPDF = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const mes    = window.reporteMensualMes || document.getElementById('mesConsulta').value;
    const fechas = window.reporteMensualFechas || [];
    const DS     = ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'];
    const ME     = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
                    'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
    const [year, month] = mes.split('-').map(Number);

    // ── Encabezado institucional ────────────────────────────
    docPDF.setFont("Helvetica", "bold");
    docPDF.setFontSize(12);
    docPDF.setTextColor(21, 128, 61);
    docPDF.text("I.E. HORACIO ZEVALLOS GÁMEZ — MALINGAS", 10, 10);
    docPDF.setFontSize(8.5);
    docPDF.setTextColor(80);
    docPDF.text(`REGISTRO DE ASISTENCIA MENSUAL  |  ${ME[month-1]} ${year}`, 10, 15);
    docPDF.setFontSize(7);
    docPDF.text(`(*) = día con incidencia   |   A = Asistió    T = Tardanza    F = Falta    J = Justificado    FER = Feriado`, 10, 19);

    // ── Columnas encabezado ─────────────────────────────────
    const headCols = ["N°", "APELLIDOS Y NOMBRES", "AULA", "DNI"];
    fechas.forEach(f => headCols.push(`${DS[f.diaSemana]}\n${f.dia}`));
    headCols.push("A", "T", "F", "J", "INC.");

    // ── Filas de datos ──────────────────────────────────────
    const tableData = window.reporteMensualData.map((item, idx) => {
        const row = [idx + 1, item.nombres || '', aulaDeAlumno(item), item.dni || ''];
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
    const totRow = ['', 'TOTALES GENERALES', '', ''];
    const feriadosPDF = window.reporteMensualFeriados || new Set();
    fechas.forEach(f => {
        const esFS = f.diaSemana === 0 || f.diaSemana === 6;
        if (esFS) { totRow.push(''); return; }
        if (feriadosPDF.has(f.fecha)) { totRow.push('FER'); return; } // feriado: no cuenta
        let cA=0,cT=0,cF=0;
        window.reporteMensualData.forEach(item => {
            const reg = item.diasReg ? item.diasReg[f.fecha] : null;
            const l = getEstadoCelda(reg).letra; // misma clasificación que la tabla
            if      (l === 'A') cA++;
            else if (l === 'T') cT++;
            else if (l === 'F') cF++;
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

    // ── Ancho dinámico: que la tabla ocupe TODO el ancho de la hoja A4 ─
    const margenLat = 6;
    const anchoPagina = docPDF.internal.pageSize.getWidth();
    const anchoUtil   = anchoPagina - (margenLat * 2);
    const wNum = 6, wNom = 40, wAula = 12, wDni = 15, wResumen = 8;
    const anchoFijo = wNum + wNom + wAula + wDni + (wResumen * 5);
    const nDias = fechas.length;
    const wDia = Math.max(4, (anchoUtil - anchoFijo) / Math.max(nDias, 1));

    // columnStyles dinámico
    const colStyles = {
        0: { cellWidth: wNum },
        1: { cellWidth: wNom, halign: 'left' },
        2: { cellWidth: wAula, fontStyle: 'bold' },
        3: { cellWidth: wDni }
    };
    for (let d = 0; d < nDias; d++) colStyles[4 + d] = { cellWidth: wDia };
    for (let r = 0; r < 5; r++)     colStyles[4 + nDias + r] = { cellWidth: wResumen, fontStyle: 'bold' };

    // ── Tabla principal ─────────────────────────────────────
    docPDF.autoTable({
        startY: 22,
        head: [headCols],
        body: tableData,
        theme: 'grid',
        margin: { left: margenLat, right: margenLat },
        tableWidth: 'wrap',
        styles:     { fontSize: 5, cellPadding: 0.6, halign: 'center', valign: 'middle', overflow: 'linebreak', minCellHeight: 4, lineWidth: 0.1 },
        headStyles: { fillColor: [21, 128, 61], textColor: 255, fontSize: 5, fontStyle: 'bold', halign: 'center', valign: 'middle' },
        columnStyles: colStyles,
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
    let nIncPDF = 0;
    window.reporteMensualData.forEach(item => {
        (item.listadoInc || []).forEach(inc => {
            incList.push([
                ++nIncPDF,
                item.nombres || '',
                aulaDeAlumno(item),
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
        docPDF.setFontSize(13);
        docPDF.setTextColor(234, 88, 12);
        docPDF.text("DETALLE DE INCIDENCIAS — " + ME[month-1] + ' ' + year, 10, 13);
        docPDF.setFontSize(9);
        docPDF.setTextColor(100);
        docPDF.text(`Total de incidencias registradas: ${incList.length}`, 10, 19);

        docPDF.autoTable({
            startY: 23,
            margin: { left: 8, right: 8 },
            head: [['N°', 'APELLIDOS Y NOMBRES', 'AULA', 'DNI', 'FECHA', 'DÍA', 'TIPO', 'DESCRIPCIÓN']],
            body: incList,
            theme: 'striped',
            styles:     { fontSize: 9, cellPadding: 2, valign: 'middle', overflow: 'linebreak' },
            headStyles: { fillColor: [234, 88, 12], textColor: 255, fontStyle: 'bold', fontSize: 9 },
            alternateRowStyles: { fillColor: [255, 237, 213] },
            columnStyles: {
                0: { cellWidth: 10, halign: 'center' },
                1: { cellWidth: 58 },
                2: { cellWidth: 18 },
                3: { cellWidth: 22 },
                4: { cellWidth: 24 },
                5: { cellWidth: 18 },
                6: { cellWidth: 28 },
                7: { cellWidth: 'auto' }
            }
        });
    }

    // ── PÁGINA 3: Detalle de Tardanzas ──────────────────────
    const tardList = [];
    let nTardPDF = 0;
    window.reporteMensualData.forEach(item => {
        (item.listadoTard || []).forEach(t => {
            tardList.push([
                ++nTardPDF,
                item.nombres || '',
                aulaDeAlumno(item),
                item.dni || '',
                t.fecha,
                `${DS[t.diaSemana]} ${t.dia}`,
                t.hora || '',
                t.estado || 'Tardanza'
            ]);
        });
    });

    if (tardList.length > 0) {
        docPDF.addPage();
        docPDF.setFont("Helvetica", "bold");
        docPDF.setFontSize(13);
        docPDF.setTextColor(217, 119, 6);
        docPDF.text("DETALLE DE TARDANZAS — " + ME[month-1] + ' ' + year, 10, 13);
        docPDF.setFontSize(9);
        docPDF.setTextColor(100);
        docPDF.text(`Total de tardanzas registradas: ${tardList.length}`, 10, 19);

        docPDF.autoTable({
            startY: 23,
            margin: { left: 8, right: 8 },
            head: [['N°', 'APELLIDOS Y NOMBRES', 'AULA', 'DNI', 'FECHA', 'DÍA', 'HORA', 'ESTADO']],
            body: tardList,
            theme: 'striped',
            styles:     { fontSize: 9, cellPadding: 2, valign: 'middle', overflow: 'linebreak' },
            headStyles: { fillColor: [217, 119, 6], textColor: 255, fontStyle: 'bold', fontSize: 9 },
            alternateRowStyles: { fillColor: [254, 243, 199] },
            columnStyles: {
                0: { cellWidth: 10, halign: 'center' },
                1: { cellWidth: 58 },
                2: { cellWidth: 18 },
                3: { cellWidth: 22 },
                4: { cellWidth: 24 },
                5: { cellWidth: 18 },
                6: { cellWidth: 24 },
                7: { cellWidth: 'auto' }
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

    // 1. CARGA MASIVA: Traemos asistencia y alumnos en paralelo
    const [snapAsistencia, snapAlumnos] = await Promise.all([
        getDocs(collection(db, "asistencia", hoyId, "registros")),
        getDocs(collection(db, "alumnos"))
    ]);

    if (snapAsistencia.empty) return alert("No hay datos para exportar hoy.");

    // 2. Diccionario de alumnos
    const mapaAlumnos = {};
    snapAlumnos.forEach(docAlu => { mapaAlumnos[docAlu.id] = docAlu.data(); });

    // 3. PROCESAMIENTO → lista unificada ordenada por grado/sección luego por nombre
    const filas = [];
    snapAsistencia.forEach(d => {
        const dataAsis = d.data();
        const aluInfo = mapaAlumnos[d.id] || {};
        const gradoSec = aluInfo.grado && aluInfo.seccion
            ? `${aluInfo.grado}° "${aluInfo.seccion}"`.toUpperCase()
            : "N/A";
        const incidencias = [
            dataAsis.alertaSalud || "",
            dataAsis.alertaConducta || "",
            dataAsis.alertaCorte || "",
            dataAsis.alertaVestimenta || "",
            (dataAsis.conductaAlerta || "").replace("⚠️ ", "")
        ].filter(x => x !== "").map(x => x.toUpperCase());

        filas.push({
            gradoSec,
            nombre: dataAsis.nombres?.toUpperCase() || "DESCONOCIDO",
            fila: [
                dataAsis.hora || '--:--',
                d.id,
                dataAsis.nombres?.toUpperCase() || "DESCONOCIDO",
                gradoSec,
                dataAsis.estado?.toUpperCase() || "FALTÓ",
                incidencias.join(", ")
            ]
        });
    });

    // Ordenar: primero por grado/sección, luego por nombre
    filas.sort((a, b) => a.gradoSec.localeCompare(b.gradoSec) || a.nombre.localeCompare(b.nombre));

    // 4. Numerar y construir array para autoTable
    const tableBody = filas.map((item, idx) => [idx + 1, ...item.fila]);

    // 5. ENCABEZADO INSTITUCIONAL (una sola página o las que autoTable necesite)
    docPDF.setTextColor(21, 128, 61);
    docPDF.setFontSize(16);
    docPDF.setFont("helvetica", "bold");
    docPDF.text("I.E. HORACIO ZEVALLOS GÁMEZ", 14, 18);

    docPDF.setFontSize(10);
    docPDF.setTextColor(100);
    docPDF.text("MALINGAS - TAMBOGRANDE  |  REPORTE DIARIO DE ASISTENCIA", 14, 24);

    docPDF.setDrawColor(21, 128, 61);
    docPDF.line(14, 26, 196, 26);

    docPDF.setTextColor(0);
    docPDF.setFontSize(11);
    docPDF.text(`FECHA: ${hoyId}`, 14, 33);
    docPDF.setFontSize(9);
    docPDF.setTextColor(80);
    docPDF.text(`Total registros: ${filas.length}`, 14, 39);

    // 6. TABLA ÚNICA con todos los grados
    docPDF.autoTable({
        startY: 43,
        head: [['N°', 'HORA', 'DNI', 'ESTUDIANTE', 'GRADO/SEC', 'ESTADO', 'OBSERVACIONES']],
        body: tableBody,
        headStyles: { fillColor: [21, 128, 61], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
        styles: { fontSize: 6.5, cellPadding: 2, overflow: 'linebreak', valign: 'middle' },
        columnStyles: {
            0: { cellWidth: 8, halign: 'center' },   // N°
            1: { cellWidth: 16, halign: 'center' },  // Hora
            2: { cellWidth: 20, halign: 'center' },  // DNI
            3: { cellWidth: 52 },                    // Estudiante
            4: { cellWidth: 22, halign: 'center' },  // Grado/Sec
            5: { cellWidth: 22, halign: 'center' },  // Estado
            6: { cellWidth: 'auto', textColor: [180, 0, 0], fontStyle: 'bold' } // Observaciones
        },
        alternateRowStyles: { fillColor: [240, 253, 244] },
        // Resaltar cambio de grado con fondo sutil
        willDrawCell: (data) => {
            if (data.section === 'body' && data.column.index === 4) {
                const gradoActual = tableBody[data.row.index]?.[4];
                const gradoAnterior = data.row.index > 0 ? tableBody[data.row.index - 1]?.[4] : null;
                if (gradoActual !== gradoAnterior) {
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.textColor = [21, 128, 61];
                }
            }
        },
        // Encabezado institucional en páginas adicionales
        didDrawPage: (data) => {
            if (data.pageNumber > 1) {
                docPDF.setFontSize(8);
                docPDF.setTextColor(100);
                docPDF.text(`I.E. HORACIO ZEVALLOS GÁMEZ  |  Reporte Diario ${hoyId}  |  Página ${data.pageNumber}`, 14, 10);
                docPDF.setDrawColor(200);
                docPDF.line(14, 12, 196, 12);
            }
        }
    });

    docPDF.save(`Reporte_HZG_${hoyId}.pdf`);
};

// --- 5. EXPORTACIÓN EXCEL ---
window.generarReporteExcel = async () => {
    const hoyId = new Date().toLocaleDateString('en-CA');

    // 1. Obtener todos los datos en paralelo
    const [snapAsistencia, snapAlumnos] = await Promise.all([
        getDocs(collection(db, "asistencia", hoyId, "registros")),
        getDocs(collection(db, "alumnos"))
    ]);

    if (snapAsistencia.empty) return alert("No hay datos para exportar hoy.");

    // 2. Mapa de alumnos
    const mapaAlumnos = {};
    snapAlumnos.forEach(docAlu => { mapaAlumnos[docAlu.id] = docAlu.data(); });

    // 3. Procesar → lista unificada
    const filas = [];
    snapAsistencia.forEach(d => {
        const data = d.data();
        const aluInfo = mapaAlumnos[d.id] || {};
        const gradoNum  = aluInfo.grado  || data.grado  || '?';
        const seccionLe = aluInfo.seccion || data.seccion || '?';
        const gradoSec  = `${gradoNum}° "${String(seccionLe).toUpperCase()}"`;

        const incidencias = [
            data.alertaSalud || "",
            data.alertaConducta || "",
            data.alertaCorte || "",
            data.alertaVestimenta || "",
            (data.conductaAlerta || "").replace("⚠️ ", "")
        ].filter(x => x !== "").map(x => x.toUpperCase());

        filas.push({
            gradoSec,
            nombre: (data.nombres || "DESCONOCIDO").toUpperCase(),
            row: {
                "GRADO/SEC":      gradoSec,
                "HORA":           data.hora || '--:--',
                "DNI":            d.id,
                "ESTUDIANTE":     (data.nombres || "DESCONOCIDO").toUpperCase(),
                "ESTADO":         (data.estado  || "FALTÓ").toUpperCase(),
                "OBSERVACIONES":  incidencias.join(", ")
            }
        });
    });

    // Ordenar: grado/sección → nombre
    filas.sort((a, b) => a.gradoSec.localeCompare(b.gradoSec) || a.nombre.localeCompare(b.nombre));

    // Agregar N° correlativo
    const dataExcel = filas.map((item, idx) => ({ "N°": idx + 1, ...item.row }));

    // 4. Crear libro con UNA SOLA hoja
    const ws = XLSX.utils.json_to_sheet(dataExcel);

    // Ancho de columnas
    ws['!cols'] = [
        { wch: 5 },  // N°
        { wch: 14 }, // GRADO/SEC
        { wch: 10 }, // HORA
        { wch: 13 }, // DNI
        { wch: 45 }, // ESTUDIANTE
        { wch: 16 }, // ESTADO
        { wch: 55 }  // OBSERVACIONES
    ];

    // Estilo encabezado
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

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Asistencia del Día");

    // 5. Descarga
    XLSX.writeFile(wb, `Reporte_HZG_${hoyId}.xlsx`);
};

// REEMPLAZO EXACTO: Borra la de UltraMsg y pega esta
const enviarNotificacionUltraMsg = async (telefono, nombre, estado, mensajePersonalizado = null) => {
    // URL: Ahora apunta directamente a la nube de UltraMsg
    const url = "https://api.ultramsg.com/instance169160/messages/chat";
    const token = "bkd2pujvtq9icz2w"; // El token
    
    const mensaje = mensajePersonalizado || `*I.E. HORACIO ZEVALLOS GÁMEZ*\n\nHola, se informa que el estudiante *${nombre.toUpperCase()}* registró su ingreso como: *${estado.toUpperCase()}*.\n\n_Malingas: Disciplina, Lealtad, Honradez._`;

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
                <div class="cabecera">I.E. HORACIO ZEVALLOS GÁMEZ - MALINGAS</div>
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

window.eliminarAlumno = async (id) => { if(confirm("¿Eliminar?")) { await deleteDoc(doc(db, "alumnos", id)); window.invalidarCacheAlumnos(); } };

// --- 3. JUSTIFICAR Y CONDUCTA (Sincronizado con el modelo de la App) ---
window.justificarFalta = async (dni, nombre) => {
const n = prompt(`Cambiar estado para ${nombre.toUpperCase()}:\n1. Puntual\n2. Tardanza\n3. Salida/Permiso\n4. Tardanza Justificada\n5. Falta Justificada\n6. Falta\n7. Conducta Inadecuada/Infraccion\n8. Presentacion Personal Inadecuada`, "1");

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

            case "3": // SALIDA/PERMISO
                updates = { alertaSalud: `SALIDA/PERMISO (${horaActual})` };
                mensajeWhatsApp = `*AVISO DE SALIDA - I.E. HZG*\n\nEstimado(a) *${nombreApoderado}*,\nSe informa que el estudiante *${nombre.toUpperCase()}* se retiró con SALIDA/PERMISO autorizado.\nHora: ${horaActual}\n\n_Malingas: Disciplina, Lealtad, Honradez._`;
                break;

            case "7": // CONDUCTA INADECUADA / INFRACCION
                updates = { alertaConducta: `CONDUCTA INADECUADA/INFRACCION (${horaActual})` };
                esIncidencia = true;
                mensajeWhatsApp = `*REPORTE DE CONDUCTA - I.E. HZG*\n\nEstimado(a) *${nombreApoderado}*,\nSe informa que el estudiante *${nombre.toUpperCase()}* ha presentado una *CONDUCTA INADECUADA / INFRACCION*.\nHora: ${horaActual}\n\nSe estara coordinando para que se acerque a la institución educativa.\n\n_Disciplina, Lealtad, Honradez._`;
                break;

            case "8": // PRESENTACION PERSONAL INADECUADA (unifica vestimenta + corte)
                updates = { alertaVestimenta: `PRESENTACION PERSONAL INADECUADA (${horaActual})`, alertaCorte: "" };
                mensajeWhatsApp = `*REPORTE DE PRESENTACION - I.E. HZG*\n\nEstimado(a) *${nombreApoderado}*,\nSe informa que el estudiante *${nombre.toUpperCase()}* registra: *PRESENTACION PERSONAL INADECUADA* (vestimenta y/o corte de cabello).\nHora: ${horaActual}\n\n_Malingas: Disciplina, Lealtad, Honradez._`;
                break;

            default: return;
        }

        // Si es indisciplina (7), también guardamos en el historial de conducta del alumno
        if (n === "7") {
            const idConducta = Date.now().toString();
            await setDoc(doc(db, "alumnos", dni, "conducta", idConducta), {
                fecha: hoy, hora: horaActual, incidencia: "Conducta Inadecuada/Infraccion", nombres: nombre.toUpperCase()
            });
        }

        const regActual = await getDoc(doc(db, "asistencia", hoy, "registros", dni));
        if (regActual.exists()) {
            const horaOriginal = regActual.data().hora;
            if (horaOriginal) {
                // Forzamos mantener la hora original — el merge: true solo la mantiene
                // si el campo existe, pero lo reafirmamos explícitamente por seguridad
                updates.hora = horaOriginal;
            }
        }

        // Actualizamos en la lista de asistencia de hoy (usando merge para no chancar otros datos)
        await setDoc(doc(db, "asistencia", hoy, "registros", dni), updates, { merge: true });
        
        // Enviamos notificación (borrando el anterior si existe)
        if (telefono && mensajeWhatsApp) {
            // Leer messageId anterior guardado en Firestore
            const regDoc = await getDoc(doc(db, "asistencia", hoy, "registros", dni));
            const msgIdAnterior = regDoc.exists() ? regDoc.data().whatsappMsgId : null;
            if (msgIdAnterior) await window.borrarMensajeWhatsApp(msgIdAnterior);

            // Enviar nuevo mensaje y guardar su ID
            const nuevoMsgId = await window.enviarNotificacionUltraMsg(telefono, mensajeWhatsApp);
            if (nuevoMsgId) {
                await setDoc(doc(db, "asistencia", hoy, "registros", dni), { whatsappMsgId: nuevoMsgId }, { merge: true });
            }
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
        const mensajeFinal = mensajePersonalizado || `Hola, ${nombre}. Su estado de asistencia ha sido actualizado.`;

        const response = await fetch(NUEVA_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ phone: telefono, message: mensajeFinal })
        });

        if (!response.ok) throw new Error(`Error HTTP: ${response.status}`);

        const data = await response.json().catch(() => ({}));
        const messageId = data.id || data.messageId || data.message_id || null;
        console.log("✅ Mensaje enviado. ID:", messageId);
        return messageId;
    } catch (e) {
        console.error("❌ Error al enviar mensaje:", e);
        return null;
    }
};

window.borrarMensajeWhatsApp = async (messageId) => {
    if (!messageId) return;
    try {
        await fetch(NUEVA_API_URL.replace('enviar', 'borrar'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ message_id: messageId })
        });
        console.log("🗑️ Mensaje anterior borrado:", messageId);
    } catch (e) {
        console.error("Error al borrar mensaje:", e);
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

// =========================================================
// ============= MÓDULO DE DOCENTES ========================
// =========================================================

let docentesTodosMemoria = [];
let docentesFiltradosMemoria = [];

// --- GUARDAR DOCENTE ---
document.addEventListener('DOMContentLoaded', () => {
    const docenteForm = document.getElementById('docenteForm');
    if (docenteForm) {
        docenteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const dni = document.getElementById('docenteDni').value.trim();
            const nombres = document.getElementById('docenteNombres').value.trim().toUpperCase();
            const apellidos = document.getElementById('docenteApellidos').value.trim().toUpperCase();
            const condicionRadio = document.querySelector('input[name="docenteCondicion"]:checked');
            if (!condicionRadio) return alert("Selecciona la condición laboral del docente.");
            const condicion = condicionRadio.value;

            const datos = { dni, nombres, apellidos, condicion };
            try {
                await setDoc(doc(db, "docentes", dni), datos);
                alert("✅ Docente guardado con éxito.");
                docenteForm.reset();
                document.getElementById('docenteDni').readOnly = false;
                    document.getElementById('docenteDni').classList.remove('bg-slate-100');
                window.generarCarnetDocente(dni);
            } catch (err) {
                alert("Error al guardar: " + err.message);
            }
        });
    }

    // Escuchar cambios en docentes (realtime)
    onSnapshot(collection(db, "docentes"), (snap) => {
        docentesTodosMemoria = snap.docs.map(d => d.data());
        docentesFiltradosMemoria = [...docentesTodosMemoria];
        renderizarTablaDocentes();
    });
});

// --- RENDER TABLA DOCENTES ---
function renderizarTablaDocentes() {
    const tbody = document.getElementById('tablaDocentes');
    const contador = document.getElementById('contadorDocentes');
    if (!tbody) return;
    
    if (contador) contador.textContent = docentesFiltradosMemoria.length + ' docentes';
    
    if (docentesFiltradosMemoria.length === 0) {
        // Se cambió colspan a 8 porque ahora hay más columnas
        tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-400 italic">No hay docentes registrados.</td></tr>`;
    }
    
    tbody.innerHTML = docentesFiltradosMemoria.map(d => {
        const badgeColor = d.condicion === 'NOMBRADO'
            ? 'bg-green-100 text-green-700'
            : 'bg-blue-100 text-blue-700';
            
        return `
        <tr class="hover:bg-slate-50 transition border-b border-slate-100">
            <td class="p-3 font-mono font-bold text-xs">${d.dni}</td>
            <td class="p-3 font-semibold text-sm">${d.apellidos}</td>
            <td class="p-3 text-sm text-slate-600">${d.nombres}</td>
            <td class="p-3 text-center">
                <span class="px-2 py-1 rounded-full text-[10px] font-black ${badgeColor}">${d.condicion || '---'}</span>
            </td>
           
            <td class="p-3 text-center">
                <div class="flex gap-1 justify-center">
                    <button onclick="window.generarCarnetDocente('${d.dni}')"
                        class="bg-green-600 text-white px-2 py-1 rounded-lg text-[10px] font-bold hover:bg-green-700 transition">Carnet</button>
                    <button onclick="window.editarDocente('${d.dni}', '${d.nombres}', '${d.apellidos}', '${d.condicion}')"
                        class="bg-amber-500 text-white px-2 py-1 rounded-lg text-[10px] font-bold hover:bg-amber-600 transition">Editar</button>
                    <button onclick="window.eliminarDocente('${d.dni}')"
                        class="bg-red-500 text-white px-2 py-1 rounded-lg text-[10px] font-bold hover:bg-red-700 transition">Eliminar</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// --- FILTRAR DOCENTES ---
window.filtrarDocentes = () => {
    const texto = document.getElementById('buscadorDocentes').value.toLowerCase().trim();
    docentesFiltradosMemoria = texto === ''
        ? [...docentesTodosMemoria]
        : docentesTodosMemoria.filter(d =>
            (d.nombres && d.nombres.toLowerCase().includes(texto)) ||
            (d.apellidos && d.apellidos.toLowerCase().includes(texto)) ||
            (d.dni && d.dni.includes(texto))
        );
    renderizarTablaDocentes();
};

// --- ELIMINAR DOCENTE ---
window.eliminarDocente = async (dni) => {
    if (!confirm("¿Eliminar este docente?")) return;
    await deleteDoc(doc(db, "docentes", dni));
};

// --- EDITAR DOCENTE ---
window.editarDocente = (dni, nombres, apellidos, condicion) => {
    // Navegar a la sección de registro
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
    document.getElementById('sec-registro-docentes').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Rellenar el formulario con los datos actuales
    document.getElementById('docenteDni').value = dni;
    document.getElementById('docenteDni').readOnly = true; // No permitir cambiar DNI
    document.getElementById('docenteDni').classList.add('bg-slate-100');
    document.getElementById('docenteNombres').value = nombres;
    document.getElementById('docenteApellidos').value = apellidos;

    // Marcar el radio correcto
    const radios = document.querySelectorAll('input[name="docenteCondicion"]');
    radios.forEach(r => { r.checked = r.value === condicion; });
};

// --- GENERAR CARNET DOCENTE ---
window.generarCarnetDocente = async (dni) => {
    // Ir a la sección de registro donde está el contenedor del carnet
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
    document.getElementById('sec-registro-docentes').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const container = document.getElementById('carnetDocenteContainer');
    if (!container) return;

    try {
        const docRef = doc(db, "docentes", dni);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) return alert("Docente no encontrado.");
        const d = docSnap.data();

        const condicionColor = d.condicion === 'NOMBRADO' ? '#15803d' : '#1d4ed8';
        const condicionBg = d.condicion === 'NOMBRADO' ? '#dcfce7' : '#dbeafe';

        container.innerHTML = `
        <div id="carnetDocentePrint" style="
            width: 210px;
            background: white;
            border-radius: 14px;
            overflow: hidden;
            box-shadow: 0 12px 32px rgba(0,0,0,0.15);
            font-family: 'Segoe UI', Arial, sans-serif;
            border: 2px solid #15803d;
            display: flex;
            flex-direction: column;
        ">
            <!-- FRANJA TOP -->
            <div style="height:5px; background:linear-gradient(90deg,#166534,#4ade80,#166534);"></div>

            <!-- CABECERA -->
            <div style="background:#15803d; padding:10px 12px; text-align:center; color:white;">
                <img src="logo_colegio.jpeg" style="width:46px; height:46px; border-radius:50%; border:2px solid rgba(255,255,255,0.7); object-fit:cover; margin-bottom:5px;">
                <div style="font-size:8px; font-weight:700; opacity:0.85; text-transform:uppercase; letter-spacing:0.06em;">I.E. Horacio Zevallos Gámez</div>
                <div style="font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:0.04em; margin-top:1px;">Carnet Docente</div>
                <div style="font-size:7px; opacity:0.7; margin-top:1px;">Malingas · Tambogrande</div>
            </div>

            <!-- FOTO -->
            <div style="background:#f8fafc; padding:14px 0 10px; display:flex; flex-direction:column; align-items:center; border-bottom:1px solid #e2e8f0;">
                <div style="
                    width:52px; height:62px;
                    border:2px dashed #86efac;
                    border-radius:8px;
                    background:#f0fdf4;
                    display:flex; flex-direction:column;
                    align-items:center; justify-content:center;
                    color:#86efac; font-size:10px; font-weight:700;
                    text-align:center; gap:4px; cursor:pointer;
                    position:relative; overflow:hidden;
                " id="fotoDocenteBox_${dni}" onclick="document.getElementById('fotoDocenteInput_${dni}').click()">
                    <svg width="14" height="14" fill="none" stroke="#86efac" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                        <span style="font-size:5.5px; color:#86efac; font-weight:700; text-align:center;">Foto</span>
                    <img id="fotoDocentePreview_${dni}" src="" style="display:none;position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;">
                </div>
                <input type="file" id="fotoDocenteInput_${dni}" accept="image/*" style="display:none;"
                    onchange="
                        const f=this.files[0]; if(!f) return;
                        const r=new FileReader();
                        r.onload=e=>{
                            const img=document.getElementById('fotoDocentePreview_${dni}');
                            img.src=e.target.result; img.style.display='block';
                        };
                        r.readAsDataURL(f);
                    ">
            </div>

            <!-- DATOS -->
            <div style="padding:12px 14px; display:flex; flex-direction:column; gap:7px; flex:1;">
                <div style="text-align:center; border-bottom:1px solid #f1f5f9; padding-bottom:8px;">
                    <div style="font-size:7px; color:#94a3b8; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:2px;">Apellidos</div>
                    <div style="font-size:15px; font-weight:900; color:#0f172a; text-transform:uppercase; line-height:1.1;">${(d.apellidos||'').toUpperCase()}</div>
                    <div style="font-size:7px; color:#94a3b8; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; margin:6px 0 2px;">Nombres</div>
                    <div style="font-size:11px; font-weight:700; color:#334155; text-transform:uppercase;">${(d.nombres||'').toUpperCase()}</div>
                </div>

                <div style="display:flex; justify-content:center; gap:6px; align-items:center;">
                    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:5px; padding:4px 10px; font-size:10px; font-weight:800; color:#475569; font-family:monospace;">
                        DNI: ${d.dni}
                    </div>
                    <div style="background:${condicionBg}; border:1px solid ${condicionColor}33; border-radius:5px; padding:4px 10px; font-size:9px; font-weight:900; color:${condicionColor}; text-transform:uppercase;">
                        ${d.condicion}
                    </div>
                </div>

                <!-- QR -->
                <div style="display:flex; flex-direction:column; align-items:center; gap:3px; margin-top:4px;">
                    <div id="qrDocente_${dni}" style="padding:3px; border:1.5px solid #e2e8f0; border-radius:6px; background:white;"></div>
                    <div style="font-size:6.5px; color:#94a3b8; font-weight:600; text-transform:uppercase; letter-spacing:0.06em;">ID Digital</div>
                </div>
            </div>

            <!-- PIE -->
            <div style="background:linear-gradient(90deg,#f0fdf4,#dcfce7,#f0fdf4); border-top:1.5px solid #bbf7d0; padding:5px 12px; text-align:center;">
                <div style="font-size:7px; color:#15803d; font-weight:900; text-transform:uppercase; letter-spacing:0.1em;">Disciplina · Lealtad · Honradez</div>
            </div>

            <!-- FRANJA BOT -->
            <div style="height:4px; background:linear-gradient(90deg,#166534,#4ade80,#166534);"></div>
        </div>

        <div style="display:flex; gap:10px; margin-top:16px;">
            <button onclick="window.imprimirCarnetDocente()"
                style="background:#15803d; color:white; border:none; padding:10px 28px; border-radius:8px; font-weight:900; font-size:12px; cursor:pointer; text-transform:uppercase; letter-spacing:0.05em; box-shadow:0 4px 12px rgba(21,128,61,0.3);">
                Imprimir Carnet
            </button>
        </div>`;

        // Generar QR dentro del carnet
        setTimeout(() => {
            const qrTarget = document.getElementById(`qrDocente_${dni}`);
            if (qrTarget) {
                new QRCode(qrTarget, { 
                    text: `DOCENTE|${dni}|${d.apellidos}|${d.condicion}`, 
                    width: 68, 
                    height: 68,
                    colorDark: "#000000",
                    colorLight: "#ffffff",
                    correctLevel: QRCode.CorrectLevel.M
                });
            }
        }, 150);

    } catch (err) {
        console.error(err);
        alert("Error al generar el carnet.");
    }
};

// --- IMPRIMIR CARNET DOCENTE ---
window.imprimirCarnetDocente = () => {
    const contenido = document.getElementById('carnetDocentePrint');
    if (!contenido) return;
    const ventana = window.open('', '_blank', 'width=500,height=400');
    ventana.document.write(`
        <!DOCTYPE html><html><head>
        <title>Imprimir Carnet - I.E. HZG</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
        <style>
            body { 
                margin:0; 
                display:flex; 
                justify-content:center; 
                align-items:center; 
                min-height:100vh; 
                background:white; 
                font-family: 'Inter', sans-serif;
            }
            @media print { 
                body { background:white; }
                #carnetDocentePrint { box-shadow: none !important; border: 1px solid #eee !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            }
        </style>
        </head><body>
        ${contenido.outerHTML}
        <script>window.onload=()=>{ setTimeout(()=>{ window.print(); window.close(); }, 500); }<\/script>
        </body></html>`);
    ventana.document.close();
};

// --- IMPRIMIR CARNETS MASIVOS DOCENTES ---
window.imprimirTodosLosCarnetsDocentes = async () => {
    if (docentesTodosMemoria.length === 0) return alert("No hay docentes registrados.");
    if (!confirm(`¿Imprimir carnets de ${docentesTodosMemoria.length} docentes?`)) return;

    const lista = [...docentesTodosMemoria].sort((a, b) => (a.apellidos||'').localeCompare(b.apellidos||''));
    const ventana = window.open('', '', 'width=1000,height=800');

    let carnets = '';
    lista.forEach(d => {
        carnets += `
        <div class="carnet">
            <div class="franja-lateral"></div>
            <div class="contenido">
                <div class="cabecera">
                    <img src="logo_colegio.jpeg" class="logo">
                    <div class="cab-texto">
                        <div class="cab-ie">I.E. Horacio Zevallos Gámez</div>
                        <div class="cab-titulo">Carnet Docente</div>
                        <div class="cab-sede">Malingas · Tambogrande</div>
                    </div>
                </div>
                <div class="foto-box">
<div style="width:28px;height:34px;border:1.5px dashed #86efac;border-radius:3px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:white;">
                        <svg width="12" height="12" fill="none" stroke="#86efac" stroke-width="1.5" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </div>
                                        <span class="foto-label">FOTO</span>
                </div>
                <div class="datos">
                    <div class="campo-label">Apellidos</div>
                    <div class="apellido">${(d.apellidos||'').toUpperCase()}</div>
                    <div class="campo-label mt4">Nombres</div>
                    <div class="nombre">${(d.nombres||'').toUpperCase()}</div>
                    <div class="dni-box">DNI: ${d.dni}</div>
                    <div class="qr-area">
                        <div class="qr-code" data-val="DOCENTE|${d.dni}|${(d.apellidos||'')}|${(d.nombres||'')}"></div>
                        <div class="qr-label">ID Digital</div>
                    </div>
                </div>
                <div class="pie">Disciplina · Lealtad · Honradez</div>
            </div>
        </div>`;
    });

    ventana.document.write(`<!DOCTYPE html><html><head>
    <title>Carnets Docentes - I.E. HZG</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700;900&display=swap');
        @page { size: A4; margin: 0.5cm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Roboto', sans-serif; background: white; }

        .grid {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 5px;
            justify-items: center;
        }

        /* Cada carnet es horizontal: franja lateral + contenido */
        .carnet {
            width: 3.8cm;
            border: 1.5px solid #15803d;
            border-radius: 6px;
            overflow: hidden;
            display: flex;
            flex-direction: row;
            page-break-inside: avoid;
            background: white;
        }

        /* Franja lateral izquierda */
        .franja-lateral {
            width: 6px;
            flex-shrink: 0;
            background: linear-gradient(180deg, #166534, #4ade80, #166534);
        }

        /* Todo el lado derecho */
        .contenido {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-width: 0;
        }

        /* Cabecera verde */
        .cabecera {
            background: #15803d;
            padding: 4px 5px;
            display: flex;
            align-items: center;
            gap: 4px;
            color: white;
        }

        .logo {
            width: 20px; height: 20px;
            border-radius: 50%;
            border: 1px solid rgba(255,255,255,0.8);
            object-fit: cover;
            flex-shrink: 0;
        }

        .cab-texto { line-height: 1.2; }
        .cab-ie    { font-size: 4px;   font-weight: 700; opacity: 0.85; text-transform: uppercase; letter-spacing: 0.04em; }
        .cab-titulo{ font-size: 6.5px; font-weight: 900; text-transform: uppercase; }
        .cab-sede  { font-size: 3.5px; opacity: 0.7; }

        /* Caja de foto */
        .foto-box {
            width: 100%;
            padding: 5px 0 4px;
            background: #f0fdf4;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 2px;
        }

        .foto-label {
            font-size: 5px;
            font-weight: 700;
            color: #86efac;
            text-transform: uppercase;
            letter-spacing: 0.07em;
        }

        /* Datos */
        .datos {
            padding: 4px 5px;
            display: flex;
            flex-direction: column;
            gap: 0px;
            flex: 1;
        }

        .campo-label {
            font-size: 4.5px;
            color: #94a3b8;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.06em;
        }

        .mt4 { margin-top: 3px; }

        .apellido {
            font-size: 8px;
            font-weight: 900;
            color: #0f172a;
            text-transform: uppercase;
            line-height: 1.1;
            word-break: break-word;
        }

        .nombre {
            font-size: 6px;
            font-weight: 700;
            color: #334155;
            text-transform: uppercase;
            line-height: 1.1;
            word-break: break-word;
        }

        .dni-box {
            margin-top: 3px;
            background: #f1f5f9;
            border: 1px solid #e2e8f0;
            border-radius: 3px;
            padding: 2px 4px;
            font-size: 5.5px;
            font-weight: 800;
            color: #475569;
            font-family: monospace;
            text-align: center;
        }

        .qr-area {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 1px;
            margin-top: 4px;
        }

        .qr-code {
            width: 40px; height: 40px;
            border: 1px solid #e2e8f0;
            border-radius: 3px;
            padding: 2px;
            background: white;
        }
        .qr-code img, .qr-code canvas { width: 36px !important; height: 36px !important; }

        .qr-label {
            font-size: 4px;
            color: #94a3b8;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .pie {
            background: linear-gradient(90deg, #f0fdf4, #dcfce7, #f0fdf4);
            border-top: 1px solid #bbf7d0;
            text-align: center;
            font-size: 4.5px;
            color: #15803d;
            font-weight: 900;
            padding: 2px 4px;
            text-transform: uppercase;
            letter-spacing: 0.07em;
        }

        @media print {
            .carnet { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
    </style>
    </head><body>
    <div class="grid">${carnets}</div>
    <script>
        document.querySelectorAll('.qr-code').forEach(div => {
            new QRCode(div, {
                text: div.getAttribute('data-val'),
                width: 36, height: 36,
                correctLevel: QRCode.CorrectLevel.M
            });
        });
        setTimeout(() => { window.print(); window.close(); }, 1000);
    <\/script>
    </body></html>`);
    ventana.document.close();
};
// =========================================================
// ===== MÓDULO ASISTENCIA & REPORTES DOCENTES =============
// =========================================================

// --- ASISTENCIA DIARIA DOCENTES (tiempo real) ---
window.cargarAsistenciaDocentesDelDia = (fechaManual = null) => {
    const hoy = fechaManual || new Date().toLocaleDateString('en-CA');
    const inputFecha = document.getElementById('fechaConsultaDocentes');
    if (inputFecha && !fechaManual) inputFecha.value = hoy;

    const contenedor = document.getElementById('asistenciaDocentesHoy');
    if (!contenedor) return;

    onSnapshot(collection(db, "asistenciaDocentes", hoy, "registros"), (snapshot) => {
        contenedor.innerHTML = "";

        if (snapshot.empty) {
            contenedor.innerHTML = `<div class="p-10 text-center text-slate-400 italic border-2 border-dashed rounded-xl">
                No hay registros de asistencia docente para esta fecha (${hoy}).
            </div>`;
            return;
        }

        const registros = snapshot.docs.map(d => ({ ...d.data(), dni: d.id }))
            .sort((a, b) => (a.apellidos || '').localeCompare(b.apellidos || ''));

        const tabla = document.createElement('div');
        tabla.className = "overflow-x-auto rounded-xl border border-slate-200 shadow-sm";
        
        tabla.innerHTML = `
            <table class="w-full text-left border-collapse">
                <thead>
                    <tr class="bg-green-700 text-white text-[11px] font-black uppercase">
                        <th class="p-3">Entrada</th>
                        <th class="p-3">Salida</th>
                        <th class="p-3">DNI</th>
                        <th class="p-3">Docente</th>
                        <th class="p-3 text-center">Estado</th>
                        <th class="p-3 text-center">Acciones</th>
                    </tr>
                </thead>
                <tbody class="bg-white">
                    ${registros.map(reg => {
                        const est = (reg.estado || '').toUpperCase();
                        
                        // Lógica de colores corregida
                        let colorEstado = 'bg-red-100 text-red-700 border-red-200';
                        if (est.includes('PUNTUAL')) colorEstado = 'bg-green-100 text-green-700 border-green-200';
                        else if (est.includes('TARDANZA')) colorEstado = 'bg-yellow-100 text-yellow-700 border-yellow-200';
                        else if (est.includes('SALIDA')) colorEstado = 'bg-blue-100 text-blue-700 border-blue-200';
                        else if (est.includes('JUSTIFICAD')) colorEstado = 'bg-indigo-100 text-indigo-700 border-indigo-200';
                        else if (est.includes('EVENTO')) colorEstado = 'bg-purple-100 text-purple-700 border-purple-200';

                        return `<tr class="border-b last:border-0 hover:bg-slate-50 transition">
                            <td class="p-3 font-bold text-green-700 text-sm">
                                ${reg.horaEntrada || reg.hora || '--:--'}
                            </td>
                            <td class="p-3 font-bold text-blue-600 text-sm">
                                ${reg.horaSalida || '--:--'}
                            </td>
                            <td class="p-3 font-mono text-xs text-slate-500">${reg.dni}</td>
                            <td class="p-3">
                                <div class="font-bold text-slate-700 text-sm">${reg.apellidos || ''}</div>
                                <div class="text-xs text-slate-400">${reg.nombres || ''}</div>
                            </td>
                            <td class="p-3 text-center">
                                <span class="px-2 py-1 rounded-full text-[10px] font-black border ${colorEstado}">
                                    ${est || 'FALTÓ'}
                                </span>
                                ${est.includes('EVENTO') && reg.horaEvento ? `
                                <div class="text-[9px] text-purple-600 font-bold mt-1">
                                    Hora: ${reg.horaEvento}
                                </div>` : ''}
                            </td>
                            <td class="p-3 text-center">
                                <button onclick="window.cambiarEstadoDocente('${reg.dni}', '${reg.nombres} ${reg.apellidos}', '${hoy}')"
                                    class="text-[10px] font-black text-blue-600 hover:text-blue-800 uppercase hover:underline">
                                    EDITAR
                                </button>
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>`;
        contenedor.appendChild(tabla);

        // --- RESUMEN DE CONTEO ---
        const total = registros.length;
        const puntuales = registros.filter(r => (r.estado || '').toUpperCase().includes('PUNTUAL')).length;
        const tardanzas = registros.filter(r => (r.estado || '').toUpperCase().includes('TARDANZA')).length;
        const faltas = registros.filter(r => {
            const e = (r.estado || '').toUpperCase();
            return e === '' || e.includes('FALTA');
        }).length;
        const eventos = registros.filter(r => (r.estado || '').toUpperCase().includes('EVENTO')).length;

        const resumen = document.createElement('div');
        resumen.className = "mt-4 grid grid-cols-5 gap-3";
        resumen.innerHTML = `
            <div class="bg-slate-50 rounded-xl p-3 text-center border">
                <p class="text-xs font-black text-slate-500 uppercase">Total</p>
                <p class="text-2xl font-black text-slate-700">${total}</p>
            </div>
            <div class="bg-green-50 rounded-xl p-3 text-center border border-green-100">
                <p class="text-xs font-black text-green-600 uppercase">Puntuales</p>
                <p class="text-2xl font-black text-green-700">${puntuales}</p>
            </div>
            <div class="bg-yellow-50 rounded-xl p-3 text-center border border-yellow-100">
                <p class="text-xs font-black text-yellow-600 uppercase">Tardanzas</p>
                <p class="text-2xl font-black text-yellow-700">${tardanzas}</p>
            </div>
            <div class="bg-red-50 rounded-xl p-3 text-center border border-red-100">
                <p class="text-xs font-black text-red-600 uppercase">Faltas</p>
                <p class="text-2xl font-black text-red-700">${faltas}</p>
            </div>
            <div class="bg-purple-50 rounded-xl p-3 text-center border border-purple-100">
                <p class="text-xs font-black text-purple-600 uppercase">Evento/Reunión</p>
                <p class="text-2xl font-black text-purple-700">${eventos}</p>
            </div>`;
        contenedor.appendChild(resumen);
    });
};

// --- REGISTRAR ASISTENCIA MANUAL ---
window.registrarAsistenciaDocenteManual = async () => {
    const hoy = document.getElementById('fechaConsultaDocentes')?.value || new Date().toLocaleDateString('en-CA');
    const snap = await getDocs(collection(db, "docentes"));
    if (snap.empty) return alert("No hay docentes registrados. Primero registra docentes en la sección 'Docentes'.");

    const lista = snap.docs.map(d => d.data()).sort((a,b) => (a.apellidos||'').localeCompare(b.apellidos||''));
    const opciones = lista.map((d, i) => `${i+1}. ${d.apellidos} ${d.nombres} (${d.dni})`).join('\n');
    const sel = prompt(`Selecciona el número del docente:\n\n${opciones}`);
    if (!sel) return;
    const idx = parseInt(sel) - 1;
    if (isNaN(idx) || idx < 0 || idx >= lista.length) return alert("Selección inválida.");

    const docente = lista[idx];
    const estadoSel = prompt(`Estado para ${docente.apellidos} ${docente.nombres}:\n1. Puntual\n2. Tardanza\n3. Tardanza Justificada\n4. Falta Justificada\n5. Falta\n6. Evento/Reunión`, "1");
    const estados = { "1": "Puntual", "2": "Tardanza", "3": "Tardanza Justificada", "4": "Falta Justificada", "5": "Falta", "6": "Evento/Reunión" };
    const estado = estados[estadoSel];
    if (!estado) return;

    const hora = new Date().toLocaleTimeString('es-PE', { hour12: false });

    let horaEvento = null;
    if (estadoSel === "6") {
        horaEvento = prompt(`Ingresa la hora del evento/reunión (ej: 09:00):`, hora);
        if (!horaEvento) return;
    }

    const datosReg = {
        dni: docente.dni, nombres: docente.nombres, apellidos: docente.apellidos,
        condicion: docente.condicion, hora, estado, fecha: hoy
    };
    if (horaEvento) datosReg.horaEvento = horaEvento;

    await setDoc(doc(db, "asistenciaDocentes", hoy, "registros", docente.dni), datosReg, { merge: true });
    alert(`✅ Asistencia registrada para ${docente.apellidos} ${docente.nombres}`);
};

// --- CAMBIAR ESTADO DOCENTE ---
window.cambiarEstadoDocente = async (dni, nombre, fecha) => {
    const n = prompt(`Estado para ${nombre.toUpperCase()}:\n1. Puntual\n2. Tardanza\n3. Tardanza Justificada\n4. Falta Justificada\n5. Falta\n6. Evento/Reunión`, "1");
    const estados = { "1": "Puntual", "2": "Tardanza", "3": "Tardanza Justificada", "4": "Falta Justificada", "5": "Falta", "6": "Evento/Reunión" };
    const estado = estados[n];
    if (!estado) return;
    const hora = new Date().toLocaleTimeString('es-PE', { hour12: false });

    let horaEvento = null;
    if (n === "6") {
        horaEvento = prompt(`Ingresa la hora del evento/reunión (ej: 09:00):`, hora);
        if (!horaEvento) return;
    }

    const datos = { estado, hora };
    if (horaEvento) datos.horaEvento = horaEvento;

    await setDoc(doc(db, "asistenciaDocentes", fecha, "registros", dni), datos, { merge: true });
};

// --- CERRAR DÍA DOCENTES ---
window.cerrarDiaDocentes = async () => {
    const hoy = new Date().toLocaleDateString('en-CA');
    if (!confirm("¿Finalizar día?\n\nLos docentes sin ningún registro serán marcados como FALTA.")) return;

    const [snapDoc, snapAsis] = await Promise.all([
        getDocs(collection(db, "docentes")),
        getDocs(collection(db, "asistenciaDocentes", hoy, "registros"))
    ]);

    const yaRegistrados = new Set(snapAsis.docs.map(d => d.id));
    const batch = writeBatch(db);
    let contFalta = 0;

    snapDoc.forEach(d => {
        if (!yaRegistrados.has(d.id)) {
            const dat = d.data();
            batch.set(doc(db, "asistenciaDocentes", hoy, "registros", d.id), {
                dni: dat.dni,
                nombres: dat.nombres,
                apellidos: dat.apellidos,
                condicion: dat.condicion,
                hora: "--:--",
                estado: "Falta",
                fecha: hoy
            }, { merge: true });
            contFalta++;
        }
    });

    await batch.commit();

    if (contFalta === 0) {
        alert("✅ Todos los docentes ya tienen registro. No se realizaron cambios.");
    } else {
        alert(`✅ Día finalizado.\n\n${contFalta} docente(s) marcado(s) como FALTA por no registrar asistencia.`);
    }
};

// --- PDF DIARIO DOCENTES ---
window.generarReporteDocentesPDF = async () => {
    const { jsPDF } = window.jspdf;
    const hoy = document.getElementById('fechaConsultaDocentes')?.value || new Date().toLocaleDateString('en-CA');
    const snap = await getDocs(collection(db, "asistenciaDocentes", hoy, "registros"));
    
    if (snap.empty) return alert("No hay datos para exportar.");

    const docPDF = new jsPDF();
    // Extraemos los datos y nos aseguramos de capturar el DNI (id del doc)
    const registros = snap.docs.map(d => ({ ...d.data(), dni: d.id }))
        .sort((a,b) => (a.apellidos || '').localeCompare(b.apellidos || ''));

    // Encabezado con colores institucionales
    docPDF.setTextColor(21, 128, 61);
    docPDF.setFontSize(14); docPDF.setFont("helvetica","bold");
    docPDF.text("I.E. HORACIO ZEVALLOS GÁMEZ", 14, 14);
    docPDF.setFontSize(9); docPDF.setTextColor(80);
    docPDF.text(`MALINGAS - TAMBOGRANDE | ASISTENCIA DOCENTES`, 14, 20);
    docPDF.setDrawColor(21,128,61); docPDF.line(14,22,196,22);
    docPDF.setTextColor(0); docPDF.setFontSize(10);
    docPDF.text(`FECHA DE REPORTE: ${hoy}`, 14, 28);

    const body = registros.map((r, i) => [
    i + 1, 
    r.dni, 
    `${r.apellidos || ''} ${r.nombres || ''}`.trim(),
    r.horaEntrada || r.hora || '--:--', // Columna Entrada
    r.horaSalida || '--:--',            // Columna Salida
    (r.estado || 'Falta').toUpperCase()
]);

docPDF.autoTable({
    startY: 33,
    head: [['N°','DNI','DOCENTE','ENTRADA','SALIDA','ESTADO']],
    body,
        headStyles: { fillColor: [21,128,61], textColor: 255, fontStyle:'bold', fontSize:8 },
        styles: { fontSize:8, cellPadding:2, overflow:'linebreak' },
        columnStyles: { 2: { cellWidth: 60 } },
        alternateRowStyles: { fillColor: [240,253,244] }
    });

    // Lógica de contadores corregida para que coincida con la APP (Mayúsculas)
    const total = registros.length;
    const p = registros.filter(r => (r.estado || '').toUpperCase().includes('PUNTUAL')).length;
    const t = registros.filter(r => (r.estado || '').toUpperCase().includes('TARDANZA')).length;
    const f = registros.filter(r => {
        const est = (r.estado || '').toUpperCase();
        return est === '' || est.includes('FALTA');
    }).length;

    const y = docPDF.lastAutoTable.finalY + 10;
    docPDF.setFontSize(9); docPDF.setTextColor(50);
    docPDF.text(`RESUMEN: Total: ${total} | Puntuales: ${p} | Tardanzas: ${t} | Faltas: ${f}`, 14, y);

    docPDF.save(`Asistencia_Docentes_${hoy}.pdf`);
};

// --- EXCEL DIARIO DOCENTES ---
window.generarReporteDocentesExcel = async () => {
    const hoy = document.getElementById('fechaConsultaDocentes')?.value || new Date().toLocaleDateString('en-CA');
    const snap = await getDocs(collection(db, "asistenciaDocentes", hoy, "registros"));
    
    if (snap.empty) return alert("No hay datos para exportar.");

    const datos = snap.docs.map(d => {
    const r = d.data();
    return { 
        "DNI": d.id, 
        "APELLIDOS": r.apellidos || '', 
        "NOMBRES": r.nombres || '',
        "ENTRADA": r.horaEntrada || r.hora || '--:--', 
        "SALIDA": r.horaSalida || '--:--', 
        "ESTADO": (r.estado || 'Falta').toUpperCase() 
    };
    }).sort((a,b) => a.APELLIDOS.localeCompare(b.APELLIDOS));

    const ws = XLSX.utils.json_to_sheet(datos);

    // Ajuste de anchos de columna
    ws['!cols'] = [{wch:12}, {wch:25}, {wch:25}, {wch:15}, {wch:10}, {wch:15}];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Asistencia");

    // Intentar descargar el archivo
    try {
        XLSX.writeFile(wb, `Asistencia_Docentes_${hoy}.xlsx`);
    } catch (error) {
        console.error("Error al generar Excel:", error);
        alert("Error al generar el Excel. Inténtalo de nuevo.");
    }
};

// =========================================================
// ===== REPORTE MENSUAL DOCENTES ==========================
// =========================================================

window.generarReporteMensualDocentes = async () => {
    const mes   = document.getElementById('mesConsultaDocentes')?.value;
    const tbody = document.getElementById('tbodyReporteDocentesMensual');
    const thead = document.getElementById('theadReporteDocentesMensual');
    if (!mes) return alert("Selecciona un mes primero.");

    tbody.innerHTML = `<tr><td colspan="10" class="p-10 text-center text-slate-400 italic">⏳ Cargando reporte de ${mes}…</td></tr>`;
    thead.innerHTML = '';

    const [year, month] = mes.split('-').map(Number);
    const diasEnMes = new Date(year, month, 0).getDate();
    const DIAS_C = ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'];
    const MESES  = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];

    const fechas = [];
    for (let d = 1; d <= diasEnMes; d++) {
        const fecha = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        fechas.push({ fecha, dia: d, diaSemana: new Date(year, month-1, d).getDay() });
    }

    // Cargar docentes
    const snapDoc = await getDocs(collection(db, "docentes"));
    const docentes = {};
    snapDoc.forEach(d => {
        const dat = d.data();
        docentes[d.id] = { ...dat, dni: d.id, diasReg: {}, asistencias:0, tardanzas:0, faltas:0, justificados:0 };
    });

    // Cargar asistencia día a día
    const LOTE = 7;
    for (let i = 0; i < fechas.length; i += LOTE) {
        const lote = fechas.slice(i, i + LOTE);
        const snaps = await Promise.all(lote.map(f => getDocs(collection(db, "asistenciaDocentes", f.fecha, "registros"))));
        snaps.forEach((snap, si) => {
            const fInfo = lote[si];
            snap.forEach(docReg => {
                const dni = docReg.id;
                if (!docentes[dni]) return;
                docentes[dni].diasReg[fInfo.fecha] = docReg.data();
            });
        });
    }

    // Detectar feriados (días hábiles sin ningún registro)
    const feriadosSet = new Set();
    fechas.forEach(f => {
        if (f.diaSemana === 0 || f.diaSemana === 6) return;
        const tieneReg = Object.values(docentes).some(d => d.diasReg[f.fecha]);
        if (!tieneReg) feriadosSet.add(f.fecha);
    });

    // Calcular contadores
    Object.values(docentes).forEach(doc => {
        fechas.forEach(f => {
            if (f.diaSemana === 0 || f.diaSemana === 6 || feriadosSet.has(f.fecha)) return;
            const reg = doc.diasReg[f.fecha];
            if (!reg) { doc.faltas++; return; }
            const est = (reg.estado||'').toLowerCase();
            if (est.includes('justificad'))   doc.justificados++;
            if (est.includes('tardanza'))     { doc.tardanzas++; doc.asistencias++; }
            else if (est.includes('falta') && !est.includes('justificad')) doc.faltas++;
            else if (est !== '')              doc.asistencias++;
            else                              doc.faltas++;
        });
    });

    const lista = Object.values(docentes).sort((a,b) => (a.apellidos||'').localeCompare(b.apellidos||''));
    window.reporteMensualDocentesData   = lista;
    window.reporteMensualDocentesFechas = fechas;
    window.reporteMensualDocentesMes    = mes;
    window.reporteMensualDocentesFeriados = feriadosSet;

    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="p-10 text-center text-slate-400 italic">No hay docentes registrados.</td></tr>`;
        return;
    }

    // Subtítulo
    const sub = document.getElementById('reporteSubtituloDocentes');
    if (sub) sub.textContent = `Año: ${year} | Mes: ${MESES[month-1]} | ${lista.length} docentes`;

    // Encabezado de tabla
    const diasHabiles = fechas.filter(f => f.diaSemana !== 0 && f.diaSemana !== 6);
    let thHTML = `<tr>
        <th class="sticky left-0 z-30 bg-green-800 px-2 py-2 text-center border border-green-600 text-[10px]">N°</th>
        <th class="sticky bg-green-800 px-2 py-2 text-left border border-green-600 text-[10px]" style="left:30px;min-width:180px">DOCENTE</th>
        <th class="bg-green-800 px-2 py-2 text-center border border-green-600 text-[10px]">ENTRADA</th>
        <th class="bg-green-800 px-2 py-2 text-center border border-green-600 text-[10px]">SALIDA</th>`;
    fechas.forEach(f => {
        const esFS = f.diaSemana === 0 || f.diaSemana === 6;
        const esFer = feriadosSet.has(f.fecha);
        const bg = esFS ? 'bg-slate-600' : esFer ? 'bg-purple-800' : 'bg-green-700';
        thHTML += `<th class="${bg} px-1 py-2 text-center border border-green-600 text-[9px]" style="min-width:26px;max-width:26px">
            <div>${DIAS_C[f.diaSemana]}</div><div>${f.dia}</div></th>`;
    });
    thHTML += `<th class="bg-green-800 px-2 py-2 text-center border border-green-600 text-[10px]">A</th>
               <th class="bg-green-800 px-2 py-2 text-center border border-green-600 text-[10px]">T</th>
               <th class="bg-green-800 px-2 py-2 text-center border border-green-600 text-[10px]">F</th>
               <th class="bg-green-800 px-2 py-2 text-center border border-green-600 text-[10px]">J</th>
               </tr>`;
    thead.innerHTML = thHTML;

    // Filas
    const fragment = document.createDocumentFragment();
    lista.forEach((doc, idx) => {
        const tr = document.createElement('tr');
        tr.style.cssText = idx % 2 === 0 ? 'background:#f8fafc' : 'background:#fff';
        let celdas = `
            <td class="sticky left-0 z-10 text-center border border-slate-200 text-[10px] font-bold" style="background:inherit;padding:2px 4px">${idx+1}</td>
            <td class="sticky border border-slate-200 text-[10px]" style="left:30px;background:inherit;padding:3px 6px;min-width:180px">
                <div class="font-black text-slate-700">${doc.apellidos||''}</div>
                <div class="text-slate-400">${doc.nombres||''}</div>
            </td>
            <td class="border border-slate-200 text-[9px] text-center font-bold" style="padding:2px 4px;color:#15803d">
                ${(() => {
                    const entradas = Object.values(doc.diasReg||{}).map(r=>r.horaEntrada||r.hora||'').filter(Boolean).sort();
                    return entradas.length ? entradas[Math.floor(entradas.length/2)] : '--:--';
                })()}
            </td>
            <td class="border border-slate-200 text-[9px] text-center font-bold" style="padding:2px 4px;color:#1d4ed8">
                ${(() => {
                    const salidas = Object.values(doc.diasReg||{}).map(r=>r.horaSalida||'').filter(Boolean).sort();
                    return salidas.length ? salidas[Math.floor(salidas.length/2)] : '--:--';
                })()}
            </td>`;
        fechas.forEach(f => {
            const esFS = f.diaSemana === 0 || f.diaSemana === 6;
            const esFer = feriadosSet.has(f.fecha);
            if (esFS) {
                celdas += `<td style="background:#e2e8f0;min-width:26px;max-width:26px;border:1px solid #cbd5e1;"></td>`;
            } else if (esFer) {
                celdas += `<td style="background:#f3e8ff;min-width:26px;max-width:26px;border:1px solid #e2e8f0;text-align:center;padding:2px;vertical-align:middle;">
                    <span style="font-size:7px;font-weight:900;color:#7c3aed;">FER</span></td>`;
            } else {
                const reg = doc.diasReg[f.fecha];
                if (!reg) {
                    celdas += `<td style="background:#fee2e2;min-width:26px;max-width:26px;border:1px solid #fecaca;text-align:center;padding:2px;vertical-align:middle;">
                        <span style="font-size:9px;font-weight:900;color:#dc2626;">F</span></td>`;
                } else {
                    const est = (reg.estado||'').toLowerCase();
                    const letra = est.includes('justificad') ? 'J' : est.includes('tardanza') ? 'T' : est.includes('falta') ? 'F' : 'A';
                    const bg = letra==='A' ? '#dcfce7' : letra==='T' ? '#fef3c7' : letra==='J' ? '#dbeafe' : '#fee2e2';
                    const col = letra==='A' ? '#15803d' : letra==='T' ? '#d97706' : letra==='J' ? '#1d4ed8' : '#dc2626';
                    celdas += `<td title="${reg.estado||''}" style="background:${bg};min-width:26px;max-width:26px;border:1px solid #e2e8f0;text-align:center;padding:2px;vertical-align:middle;">
                        <span style="font-size:9px;font-weight:900;color:${col};">${letra}</span></td>`;
                }
            }
        });
        celdas += `
            <td style="text-align:center;border:1px solid #86efac;padding:2px;background:#f0fdf4"><span style="font-size:10px;font-weight:900;color:#15803d">${doc.asistencias}</span></td>
            <td style="text-align:center;border:1px solid #fde68a;padding:2px;background:#fffbeb"><span style="font-size:10px;font-weight:900;color:#d97706">${doc.tardanzas}</span></td>
            <td style="text-align:center;border:1px solid #fecaca;padding:2px;background:#fff5f5"><span style="font-size:10px;font-weight:900;color:#dc2626">${doc.faltas}</span></td>
            <td style="text-align:center;border:1px solid #bfdbfe;padding:2px;background:#eff6ff"><span style="font-size:10px;font-weight:900;color:#1d4ed8">${doc.justificados}</span></td>`;
        tr.innerHTML = celdas;
        fragment.appendChild(tr);
    });

    // Fila totales
    const trTot = document.createElement('tr');
    trTot.style.cssText = 'background:#f0fdf4;font-weight:900;border-top:3px solid #15803d;';
    const sumA = lista.reduce((s,d)=>s+d.asistencias,0);
    const sumT = lista.reduce((s,d)=>s+d.tardanzas,0);
    const sumF = lista.reduce((s,d)=>s+d.faltas,0);
    const sumJ = lista.reduce((s,d)=>s+d.justificados,0);
    let totCeldas = `
        <td colspan="4" style="position:sticky;left:0;z-index:10;background:#dcfce7;padding:4px 8px;border:1px solid #86efac;font-size:11px;font-weight:900;color:#166534;text-transform:uppercase;">
            TOTALES GENERALES
        </td>`;
    fechas.forEach((f, fi) => {
        const esFS = f.diaSemana === 0 || f.diaSemana === 6;
        const esFer = feriadosSet.has(f.fecha);
        if (esFS) {
            totCeldas += `<td style="background:#e2e8f0;min-width:26px;max-width:26px;border:1px solid #cbd5e1;"></td>`;
        } else if (esFer) {
            totCeldas += `<td style="background:#f3e8ff;min-width:26px;max-width:26px;border:1px solid #e2e8f0;text-align:center;padding:2px;">
                <span style="font-size:7px;font-weight:900;color:#7c3aed;">FER</span></td>`;
        } else {
            let cA=0,cT=0,cF=0;
            lista.forEach(d => {
                const reg = d.diasReg[f.fecha];
                if (!reg) { cF++; return; }
                const est=(reg.estado||'').toLowerCase();
                if(est.includes('tardanza'))cT++;
                else if(est.includes('falta')&&!est.includes('justificad'))cF++;
                else if(est!=='')cA++;
                else cF++;
            });
            totCeldas += `<td style="min-width:26px;max-width:26px;padding:2px 1px;text-align:center;border:1px solid #86efac;vertical-align:top;font-size:7px;background:#f0fdf4;">
                ${cA>0?`<div style="color:#15803d;font-weight:900;line-height:1.2;">A:${cA}</div>`:''}
                ${cT>0?`<div style="color:#d97706;font-weight:900;line-height:1.2;">T:${cT}</div>`:''}
                ${cF>0?`<div style="color:#dc2626;font-weight:900;line-height:1.2;">F:${cF}</div>`:''}
            </td>`;
        }
    });
    totCeldas += `
        <td style="text-align:center;border:1px solid #86efac;background:#dcfce7;padding:4px"><span style="background:#15803d;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:900">${sumA}</span></td>
        <td style="text-align:center;border:1px solid #86efac;background:#dcfce7;padding:4px"><span style="background:#d97706;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:900">${sumT}</span></td>
        <td style="text-align:center;border:1px solid #86efac;background:#dcfce7;padding:4px"><span style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:900">${sumF}</span></td>
        <td style="text-align:center;border:1px solid #86efac;background:#dcfce7;padding:4px"><span style="background:#1d4ed8;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:900">${sumJ}</span></td>`;
    trTot.innerHTML = totCeldas;
    fragment.appendChild(trTot);
    tbody.appendChild(fragment);
};

// --- EXCEL MENSUAL DOCENTES ---
window.descargarReporteMensualDocentesExcel = () => {
    const data   = window.reporteMensualDocentesData;
    const fechas = window.reporteMensualDocentesFechas;
    const mes    = window.reporteMensualDocentesMes;
    const feriados = window.reporteMensualDocentesFeriados || new Set();
    if (!data || data.length === 0) return alert("Primero genera el reporte.");
    const DS = ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'];

    const filas = data.map((d, i) => {
        const entradasMes = Object.values(d.diasReg||{}).map(r=>r.horaEntrada||r.hora||'').filter(Boolean).sort();
        const salidasMes  = Object.values(d.diasReg||{}).map(r=>r.horaSalida||'').filter(Boolean).sort();
        const entPromedio = entradasMes.length ? entradasMes[Math.floor(entradasMes.length/2)] : '--:--';
        const salPromedio = salidasMes.length  ? salidasMes[Math.floor(salidasMes.length/2)]   : '--:--';
        const row = { "N°": i+1, "APELLIDOS": d.apellidos||'', "NOMBRES": d.nombres||'', "DNI": d.dni||'', "ENTRADA PROM.": entPromedio, "SALIDA PROM.": salPromedio };
        fechas.forEach(f => {
            const colKey = `${DS[f.diaSemana]} ${f.dia}`;
            if (f.diaSemana===0||f.diaSemana===6) { row[colKey]=''; return; }
            if (feriados.has(f.fecha)) { row[colKey]='FER'; return; }
            const reg = d.diasReg?d.diasReg[f.fecha]:null;
            if (!reg) { row[colKey]='F'; return; }
            const est=(reg.estado||'').toLowerCase();
            row[colKey] = est.includes('justificad')?'J':est.includes('tardanza')?'T':est.includes('falta')?'F':'A';
        });
        row["ASIST."]=d.asistencias||0; row["TARD."]=d.tardanzas||0;
        row["FALTAS"]=d.faltas||0; row["JUSTIF."]=d.justificados||0;
        return row;
    });

    const ws = XLSX.utils.json_to_sheet(filas);
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let C=range.s.c;C<=range.e.c;++C) {
        const cell=XLSX.utils.encode_cell({r:0,c:C});
        if(!ws[cell])continue;
        ws[cell].s={fill:{fgColor:{rgb:"15803D"}},font:{color:{rgb:"FFFFFF"},bold:true},alignment:{horizontal:"center"}};
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Asistencia Docentes");
    XLSX.writeFile(wb, `Asistencia_Mensual_Docentes_${mes}.xlsx`);
};

// --- PDF MENSUAL DOCENTES ---
window.descargarReporteMensualDocentesPDF = () => {
    const data   = window.reporteMensualDocentesData;
    const fechas = window.reporteMensualDocentesFechas;
    const mes    = window.reporteMensualDocentesMes;
    const feriados = window.reporteMensualDocentesFeriados || new Set();
    if (!data || data.length === 0) return alert("Primero genera el reporte.");

    const { jsPDF } = window.jspdf;
    const docPDF = new jsPDF({ orientation:'landscape', unit:'mm', format:'a3' });
    const DS = ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'];
    const MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
    const [year, month] = mes.split('-').map(Number);

    docPDF.setFont("Helvetica","bold"); docPDF.setFontSize(13); docPDF.setTextColor(21,128,61);
    docPDF.text("I.E. HORACIO ZEVALLOS GÁMEZ — MALINGAS", 14, 12);
    docPDF.setFontSize(9); docPDF.setTextColor(80);
    docPDF.text(`REGISTRO MENSUAL DE ASISTENCIA DOCENTE | ${MESES[month-1]} ${year}`, 14, 18);

    const headCols = ["N°","DOCENTE","DNI","COND."];
    fechas.forEach(f => headCols.push(`${DS[f.diaSemana]}\n${f.dia}`));
    headCols.push("A","T","F","J");

    const tableData = data.map((d, idx) => {
        const row = [idx+1, `${d.apellidos}\n${d.nombres}`, d.dni||'', d.condicion||''];
        fechas.forEach(f => {
            const esFS=f.diaSemana===0||f.diaSemana===6;
            if(esFS){row.push('');return;}
            if(feriados.has(f.fecha)){row.push('FER');return;}
            const reg=d.diasReg?d.diasReg[f.fecha]:null;
            if(!reg){row.push('F');return;}
            const est=(reg.estado||'').toLowerCase();
            row.push(est.includes('justificad')?'J':est.includes('tardanza')?'T':est.includes('falta')?'F':'A');
        });
        row.push(d.asistencias||0,d.tardanzas||0,d.faltas||0,d.justificados||0);
        return row;
    });

    const totRow=['','TOTALES','',''];
    fechas.forEach(f=>{
        const esFS=f.diaSemana===0||f.diaSemana===6;
        if(esFS){totRow.push('');return;}
        if(feriados.has(f.fecha)){totRow.push('FER');return;}
        let cA=0,cT=0,cF=0;
        data.forEach(d=>{
            const reg=d.diasReg?d.diasReg[f.fecha]:null;
            if(!reg){cF++;return;}
            const est=(reg.estado||'').toLowerCase();
            if(est.includes('tardanza'))cT++;
            else if(est.includes('falta')&&!est.includes('justificad'))cF++;
            else if(est!=='')cA++;
            else cF++;
        });
        totRow.push(`${cA}/${cT}/${cF}`);
    });
    totRow.push(data.reduce((s,d)=>s+d.asistencias,0),data.reduce((s,d)=>s+d.tardanzas,0),
                data.reduce((s,d)=>s+d.faltas,0),data.reduce((s,d)=>s+d.justificados,0));
    tableData.push(totRow);

    docPDF.autoTable({
        startY:24, head:[headCols], body:tableData, theme:'grid',
        styles:{fontSize:5.5,cellPadding:1,halign:'center',valign:'middle',overflow:'linebreak'},
        headStyles:{fillColor:[21,128,61],textColor:255,fontSize:5.5,fontStyle:'bold',halign:'center'},
        columnStyles:{0:{cellWidth:7},1:{cellWidth:45,halign:'left'},2:{cellWidth:17},3:{cellWidth:14}}
    });

    docPDF.save(`Asistencia_Mensual_Docentes_${mes}.pdf`);
};