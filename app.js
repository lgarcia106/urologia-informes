// app.js
// Aplicación de informes de urología
// Fase 4: armamos el PDF con encabezado, dos columnas y firma

console.log("App de informes de urología: JS cargado correctamente (fase PDF).");

const STORAGE_KEY_CONFIG = "medico_config";
const WORKER_URL = "https://urologia-proxy.drluisgarcia106.workers.dev/";
// ---- Audio + IA (captura en el navegador) ----
let mediaRecorder = null;
let audioChunks = [];
let estaGrabando = false;
let audioContext = null;
let audioAnalyser = null;
let audioAnimationId = null;

async function enviarAudioAlWorker(blob) {
  const formData = new FormData();
  formData.append("audio", blob, "dictado.webm");

  const respuesta = await fetch(WORKER_URL + "audio", {
    method: "POST",
    body: formData
  });

  if (!respuesta.ok) {
    const text = await respuesta.text();
    console.error("Error HTTP desde el worker (audio):", respuesta.status, text);
    throw new Error("Error HTTP en el worker de audio");
  }

  const data = await respuesta.json();
  const texto = data.text || data.transcription || "";

  if (!texto) {
    console.error("Respuesta de transcripción sin texto:", data);
    throw new Error("No se obtuvo texto transcripto");
  }

  // Guardamos la transcripción en el campo oculto para reutilizar generarInformeIA()
  const dictadoEl = document.getElementById("dictado-bruto");
  if (dictadoEl) {
    dictadoEl.value = texto;
  }

  // Ahora usamos exactamente el mismo flujo de IA que ya tenías
  await generarInformeIA();
}

function startVisualizerLoop() {
  const visualizer = document.getElementById("audio-visualizer");
  if (!visualizer || !audioAnalyser) return;
  const circle = visualizer.querySelector(".audio-circle");
  if (!circle) return;

  const bufferLength = audioAnalyser.fftSize;
  const dataArray = new Uint8Array(bufferLength);

  const draw = () => {
    audioAnimationId = requestAnimationFrame(draw);
    audioAnalyser.getByteTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = (dataArray[i] - 128) / 128; // -1 .. 1 aprox
      sum += v * v;
    }
    const rms = Math.sqrt(sum / bufferLength); // 0 .. ~1

    const scale = 1 + Math.min(rms * 3, 1.5); // 1 a ~2.5
    circle.style.transform = `scale(${scale})`;
    circle.style.opacity = (0.6 + Math.min(rms * 2, 0.4)).toString();
  };

  draw();
}

function stopVisualizerLoop() {
  const visualizer = document.getElementById("audio-visualizer");
  if (audioAnimationId) {
    cancelAnimationFrame(audioAnimationId);
    audioAnimationId = null;
  }
  if (visualizer) {
    const circle = visualizer.querySelector(".audio-circle");
    if (circle) {
      circle.style.transform = "scale(1)";
      circle.style.opacity = "0.8";
    }
    visualizer.classList.add("hidden");
  }
}

async function toggleGrabacionAudio() {
  const btn = document.getElementById("btn-generar-informe");
  const estadoAudio = document.getElementById("estado-audio");
  const estadoApp = document.getElementById("estado-app");
  const visualizer = document.getElementById("audio-visualizer");

  const setEstado = (msg) => {
    if (estadoAudio) estadoAudio.textContent = msg;
    else if (estadoApp) estadoApp.textContent = msg;
  };

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("Este navegador no permite acceder al micrófono.");
    return;
  }

  // Si NO estamos grabando -> empezar
  if (!estaGrabando) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);

      // Web Audio API para el visualizador
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      audioAnalyser = audioContext.createAnalyser();
      audioAnalyser.fftSize = 1024;
      source.connect(audioAnalyser);

      mediaRecorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          audioChunks.push(ev.data);
        }
      };

      mediaRecorder.onstop = async () => {
        try {
          const blob = new Blob(audioChunks, { type: "audio/webm" });

          // cortamos el stream de micrófono
          stream.getTracks().forEach((t) => t.stop());
          if (audioContext) {
            audioContext.close();
            audioContext = null;
            audioAnalyser = null;
          }
          stopVisualizerLoop();

          if (btn) {
            btn.disabled = true;
            btn.textContent = "Procesando audio...";
          }
          setEstado("Procesando audio y generando informe...");

          await enviarAudioAlWorker(blob);

          setEstado("Informe generado a partir del audio. Revisalo antes de crear el PDF.");
        } catch (err) {
          console.error("Error procesando audio:", err);
          alert("Ocurrió un error procesando el audio / la IA.");
          setEstado("Error al procesar el audio.");
        } finally {
          estaGrabando = false;
          if (btn) {
            btn.disabled = false;
            btn.textContent = "🎙️ Grabar informe (audio + IA)";
          }
        }
      };

      mediaRecorder.start();
      estaGrabando = true;

      if (visualizer) {
        visualizer.classList.remove("hidden");
      }
      startVisualizerLoop();

      if (btn) {
        btn.textContent = "Detener y procesar audio";
      }
      setEstado("Grabando... hablá normalmente cerca del micrófono.");

    } catch (err) {
      console.error("No se pudo iniciar la grabación:", err);
      alert("No se pudo acceder al micrófono.");
      estaGrabando = false;
      stopVisualizerLoop();
      if (btn) {
        btn.textContent = "🎙️ Grabar informe (audio + IA)";
      }
    }
  } else {
    // Si YA estamos grabando -> detener
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
  }
}

function mostrarVista(idVista) {
  // Solo manejamos las vistas visibles de la app.
  const vistas = ["config-view", "informe-view"];
  vistas.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === idVista) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });
  // #pdf-preview queda siempre fuera de pantalla y nunca se toca acá.
}

function cargarConfigDesdeStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error("Error al leer configuración desde localStorage:", e);
    return null;
  }
}

function guardarConfigEnStorage(config) {
  try {
    const raw = JSON.stringify(config);
    localStorage.setItem(STORAGE_KEY_CONFIG, raw);
  } catch (e) {
    console.error("Error al guardar configuración en localStorage:", e);
  }
}

function poblarFormularioConfig(config) {
  const nombreInput = document.getElementById("medico-nombre");
  const espInput = document.getElementById("medico-especialidad");
  const matInput = document.getElementById("medico-matricula");
  const contInput = document.getElementById("medico-contacto");

  if (nombreInput) nombreInput.value = config.nombre || "";
  if (espInput) espInput.value = config.especialidad || "";
  if (matInput) matInput.value = config.matricula || "";
  if (contInput) contInput.value = config.contacto || "";
}

// Leer archivo como DataURL (base64)
function leerArchivoComoDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

// Formatear fecha YYYY-MM-DD a DD/MM/YYYY
function formatearFecha(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

function formatearInformeParaHtml(texto) {
  if (!texto) return "";

  const lineas = texto.split(/\r?\n/).filter(l => l.trim() !== "");

  const etiquetas = [
    "Uretra",
    "Esfínter",
    "Prostata/cuello vesical",
    "Próstata/cuello vesical",
    "Vejiga \\(capacidad y paredes\\)",
    "Mucosa vesical",
    "Meatos ureterales",
    "Conclusión"
  ];

  const regex = new RegExp(`^(${etiquetas.join("|")}):\\s*(.*)$`, "i");

  const partes = [];
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i].trim();
    const match = l.match(regex);

    if (match) {
      let etiqueta = match[1]
        .replace("Prostata", "Próstata")
        .replace("\\(capacidad y paredes\\)", "(capacidad y paredes)");

      let resto = (match[2] || "").trim();

      // Si la misma línea no trae texto, usamos la siguiente línea como contenido
      if (!resto && i + 1 < lineas.length) {
        const siguiente = lineas[i + 1].trim();
        const matchSiguiente = siguiente.match(regex);
        if (!matchSiguiente && siguiente !== "") {
          resto = siguiente;
          i++; // saltamos la línea siguiente porque ya la consumimos
        }
      }

      partes.push(`<p><strong>${etiqueta}:</strong> ${resto}</p>`);
    } else {
      // Línea que no empieza con una etiqueta: la dejamos como párrafo normal
      partes.push(`<p>${l}</p>`);
    }
  }

  return partes.join("");
}

// Devuelve todos los datos necesarios para armar el PDF nativo con jsPDF
function construirContenidoPdf() {
  const config = cargarConfigDesdeStorage();
  if (!config) {
    alert("No hay configuración del médico cargada. Configurala primero.");
    mostrarVista("config-view");
    return null;
  }

  const pacienteNombre = document.getElementById("paciente-nombre")?.value.trim() || "";
  const pacienteDni = document.getElementById("paciente-dni")?.value.trim() || "";
  const pacienteOs = document.getElementById("paciente-obra-social")?.value.trim() || "";
  const medicoSolicitante = document.getElementById("medico-solicitante")?.value.trim() || "";
  const fechaEstudio = formatearFecha(
    document.getElementById("estudio-fecha")?.value || ""
  );

  const informeFinal = document.getElementById("informe-final")?.value.trim() || "";

  if (!pacienteNombre) {
    alert("Completá al menos el nombre del paciente.");
    return null;
  }
  if (!informeFinal) {
    alert("El informe final está vacío. Generá o escribí el informe antes de crear el PDF.");
    return null;
  }

  return {
    config,
    pacienteNombre,
    pacienteDni,
    pacienteOs,
    medicoSolicitante,
    fechaEstudio,
    informeFinal
  };
}

function generarPdf() {
  const datos = construirContenidoPdf();
  if (!datos) return;

  const {
    config,
    pacienteNombre,
    pacienteDni,
    pacienteOs,
    medicoSolicitante,
    fechaEstudio,
    informeFinal
  } = datos;

  const JsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!JsPDF) {
    alert("No se encontró jsPDF en la página.");
    return;
  }

  const pdf = new JsPDF("p", "mm", "a4");
  const pageWidth  = pdf.internal.pageSize.getWidth();   // ~210 mm
  const pageHeight = pdf.internal.pageSize.getHeight();  // ~297 mm

  const marginX = 15;
  let currentY = 10;          // empezamos un poco debajo del borde superior
  const lineHeight = 6;       // separación vertical estándar

  // =========================
  // 1) Membrete / encabezado
  // =========================
  if (config.logoBase64) {
    let imgType = "PNG";
    if (config.logoBase64.startsWith("data:image/jpeg") ||
        config.logoBase64.startsWith("data:image/jpg")) {
      imgType = "JPEG";
    }

    const bannerHeight = 40; // alto en mm del membrete
    pdf.addImage(
      config.logoBase64,
      imgType,
      0,
      currentY,
      pageWidth,
      bannerHeight
    );
    currentY += bannerHeight + 8;  // espacio debajo del banner
  }

  // =========================
  // 2) Caja "Datos del paciente"
  // =========================
  const boxX = marginX;
  const boxWidth = pageWidth - marginX * 2;

  // calculamos cuántas líneas habrá (Paciente siempre)
  let numLineasPaciente = 1;
  if (pacienteDni)          numLineasPaciente++;
  if (pacienteOs)           numLineasPaciente++;
  if (medicoSolicitante)    numLineasPaciente++;
  if (fechaEstudio)         numLineasPaciente++;

  pdf.setFontSize(12);
  pdf.setDrawColor(226, 232, 240); // borde gris suave
  pdf.setLineWidth(0.3);

  const tituloPacienteAltura = 7;
  const textoPacienteAltura  = numLineasPaciente * lineHeight;
  const boxPacienteHeight    = tituloPacienteAltura + textoPacienteAltura + 8; // un poco más de padding

  pdf.roundedRect(boxX, currentY, boxWidth, boxPacienteHeight, 2, 2);

  // Título "Datos del paciente" con MÁS ESPACIO
  pdf.setFont("helvetica", "bold");
  pdf.text("Datos del paciente", boxX + 4, currentY + 5);

  // texto dentro de la caja (etiqueta en negrita, valor normal)
  let textY = currentY + tituloPacienteAltura + 4; // más espacio bajo el título

  const escribirLineaDato = (label, value) => {
    pdf.setFont("helvetica", "bold");
    pdf.text(label, boxX + 4, textY);
    pdf.setFont("helvetica", "normal");
    pdf.text(value, boxX + 42, textY); // misma línea, algo más a la derecha
    textY += lineHeight;
  };

  escribirLineaDato("Paciente:", pacienteNombre);
  if (pacienteDni)       escribirLineaDato("DNI:", pacienteDni);
  if (pacienteOs)        escribirLineaDato("Obra social:", pacienteOs);
  if (medicoSolicitante) escribirLineaDato("Médico solicitante:", medicoSolicitante);
  if (fechaEstudio)      escribirLineaDato("Fecha del estudio:", fechaEstudio);

  currentY += boxPacienteHeight + 10; // más espacio debajo de la caja

  // =========================
  // 3) Caja "Informe de cistoscopia"
  // =========================
  pdf.setDrawColor(226, 232, 240);
  pdf.setLineWidth(0.3);

  // Dejamos un margen grande abajo para firma + aire
  const maxBoxBottom = pageHeight - 55;
  const disponibleVertical = maxBoxBottom - currentY;
  const boxInformeHeight = Math.max(disponibleVertical, 60);

  pdf.roundedRect(boxX, currentY, boxWidth, boxInformeHeight, 2, 2);

  // Título con más espaciado posterior
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text("Informe de cistoscopia", boxX + 4, currentY + 6);

  // Texto del informe
  pdf.setFont("helvetica", "normal");
  const informeX = boxX + 4;
  let informeY = currentY + 14; // más espacio bajo el título

  const parrafos = informeFinal.split(/\r?\n/).filter(l => l.trim() !== "");
  parrafos.forEach((p) => {
    const lineas = pdf.splitTextToSize(p, boxWidth - 8);
    lineas.forEach((linea) => {
      if (informeY > currentY + boxInformeHeight - 8) {
        return; // no seguir dibujando si se acaba el cuadro
      }
      pdf.text(linea, informeX, informeY);
      informeY += lineHeight;
    });
    informeY += 2; // pequeño espacio entre párrafos
  });

  // =========================
  // 4) Firma a la derecha (SIN tocar el recuadro)
  // =========================
  const firmaY = pageHeight - 22;   // un poco más arriba del borde inferior

  const firmaLineaAncho = 60;
  const firmaLineaX2 = pageWidth - marginX;
  const firmaLineaX1 = firmaLineaX2 - firmaLineaAncho;

  pdf.setDrawColor(15, 23, 42); // gris oscuro
  pdf.setLineWidth(0.4);
  pdf.line(firmaLineaX1, firmaY, firmaLineaX2, firmaY);

  // Imagen firma por encima de la línea, tamaño fijo (no se estira)
  if (config.firmaBase64) {
    let firmaType = "PNG";
    if (config.firmaBase64.startsWith("data:image/jpeg") ||
        config.firmaBase64.startsWith("data:image/jpg")) {
      firmaType = "JPEG";
    }
    const firmaImgAncho = 45;
    const firmaImgAlto  = 18;
    const firmaImgX = firmaLineaX2 - firmaImgAncho;
    const firmaImgY = firmaY - firmaImgAlto - 3;

    pdf.addImage(
      config.firmaBase64,
      firmaType,
      firmaImgX,
      firmaImgY,
      firmaImgAncho,
      firmaImgAlto
    );
  }

  // texto debajo de la línea de firma
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);

  const firmaNombre = config.nombre || "";
  const firmaEspecialidad = config.especialidad || "";
  const firmaMatricula = config.matricula ? `Matrícula: ${config.matricula}` : "";

  const firmaTextoLineas = [
    firmaNombre,
    [firmaEspecialidad, firmaMatricula].filter(Boolean).join(" – ")
  ].filter(Boolean);

  let firmaTextoY = firmaY + 5;
  firmaTextoLineas.forEach((linea) => {
    pdf.text(linea, firmaLineaX2, firmaTextoY, { align: "right" });
    firmaTextoY += lineHeight;
  });

  // =========================
  // 5) Guardar PDF
  // =========================
  const nombreArchivo =
    `informe-cistoscopia-${pacienteNombre.replace(/\s+/g, "_")}.pdf`;
  pdf.save(nombreArchivo);
}

// -------------------- INTEGRACIÓN IA (Worker OpenAI) --------------------

async function generarInformeIA() {
  const estado = document.getElementById("estado-app");
  const dictadoEl = document.getElementById("dictado-bruto");
  const informeFinalEl = document.getElementById("informe-final");

  const sexoEl = document.querySelector('input[name="paciente-sexo"]:checked');
  const sexo = sexoEl ? sexoEl.value : "varon";

  if (!dictadoEl || !informeFinalEl) {
    alert("No se encontró el área de dictado o el informe final.");
    return;
  }

  const dictado = dictadoEl.value.trim();
  if (!dictado) {
    alert("Escribí o dictá primero algo en el campo de dictado.");
    return;
  }

  if (estado) {
    estado.textContent = "Consultando IA para generar el informe...";
  }

  try {
    const sistema = `
Sos un médico urólogo que redacta el cuerpo del informe de una cistoscopia en español neutro médico argentino.

Tu tarea es transformar el dictado libre del médico en un informe semi-estructurado, conciso y prolijo para pegar directamente en el cuerpo del informe.

Reglas generales:
- Devolvé SOLO el cuerpo del informe, sin encabezado ni datos de paciente.
- Redactá siempre en tercera persona, en tiempo presente, con lenguaje técnico urológico.
- Longitud máxima aproximada: 200 palabras. Si el dictado es muy extenso, sintetizá manteniendo lo clínicamente relevante.

Formato de salida para paciente varón (en este orden, cada ítem en una línea separada):
Uretra: ...
Esfínter: ...
Próstata/cuello vesical: ...
Vejiga (capacidad y paredes): ...
Mucosa vesical: ...
Meatos ureterales: ...
Conclusión: ...

Formato de salida para paciente mujer (en este orden, cada ítem en una línea separada):
Uretra: ...
Esfínter: ...
Vejiga (capacidad y paredes): ...
Mucosa vesical: ...
Meatos ureterales: ...
Conclusión: ...

Completitud y normalidad por defecto:
- Siempre completá todas las secciones correspondientes al sexo del paciente, aunque el dictado no las nombre.
- Si el dictado no menciona una estructura, asumí hallazgos normales y describilos brevemente.
- En los apartados de vejiga/mucosa, si el dictado no menciona pólipos ni litiasis, incluí explícitamente la ausencia (por ejemplo: “sin imágenes de formaciones polipoides ni litiasis vesical”).
- Si el médico menciona hallazgos patológicos o particulares, priorizalos, describilos con precisión técnica y reducí el texto de las secciones normales para que lo relevante destaque.

Corrección y limpieza:
- Corregí errores de lenguaje, repeticiones e incoherencias del dictado.
- Convertí expresiones vagas en descripciones médicas claras cuando sea posible; si algo es ambiguo, usá formulaciones prudentes y conservadoras (por ejemplo, “leve hiperemia difusa” en lugar de “un poco raro”).
- No inventes hallazgos graves que el dictado no sugiera.

Adaptación según sexo:
- Usá el formato de varón o de mujer según la línea “Sexo del paciente:” que viene en el mensaje del usuario.
- Nunca incluyas la sección “Próstata/cuello vesical” en informes de mujer.

Conclusión:
- Cerrá SIEMPRE con una línea que comience con “Conclusión:”.
- En estudios sin hallazgos relevantes, usá una frase breve del tipo: “Conclusión: Cistoscopia sin hallazgos patológicos significativos.”
- Cuando el dictado describa entidades como hiperplasia prostática benigna obstructiva u otros diagnósticos, resúmilos en la conclusión con términos técnicos.
- No agregues frases administrativas ni firmas.

`.trim();

    const usuario = `
Sexo del paciente: ${sexo}.
Dictado libre del informe (texto sin procesar):
${dictado}
`.trim();

    const respuesta = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: sistema },
          { role: "user", content: usuario }
        ]
      })
    });

    if (!respuesta.ok) {
      console.error("Error HTTP desde el worker:", respuesta.status, await respuesta.text());
      alert("La IA no pudo generar el informe (error HTTP). Revisá la consola para más detalles.");
      return;
    }

    const data = await respuesta.json();
    const contenido =
      data?.choices?.[0]?.message?.content?.trim() || "";

    if (!contenido) {
      alert("La IA respondió, pero no se obtuvo texto de informe.");
      console.error("Respuesta IA sin contenido útil:", data);
      return;
    }

    informeFinalEl.value = contenido;

    if (estado) {
      estado.textContent = "Informe generado por IA. Revisalo antes de crear el PDF.";
    }

  } catch (err) {
    console.error("Error llamando al Worker/IA:", err);
    alert("Ocurrió un error al llamar a la IA. Revisá la conexión o intentá de nuevo.");
  }
}

// ------------------------------------------------------------------------

window.addEventListener("DOMContentLoaded", () => {
  const estado = document.getElementById("estado-app");
  if (estado) {
    estado.textContent = "La aplicación está funcionando correctamente (fase PDF).";
  }

  const btnGuardarConfig   = document.getElementById("btn-guardar-config");
  const btnIrConfig        = document.getElementById("btn-ir-config");
  const btnGenerarInforme  = document.getElementById("btn-generar-informe");
  const btnGenerarPdf      = document.getElementById("btn-generar-pdf");

  const configGuardada = cargarConfigDesdeStorage();
  if (configGuardada) {
    console.log("Configuración encontrada en localStorage:", configGuardada);
    poblarFormularioConfig(configGuardada);
    mostrarVista("informe-view");
  } else {
    console.log("No hay configuración previa, mostrando vista de configuración.");
    mostrarVista("config-view");
  }

  if (btnGuardarConfig) {
    btnGuardarConfig.addEventListener("click", async () => {
      const nombre = document.getElementById("medico-nombre")?.value.trim() || "";
      const especialidad = document.getElementById("medico-especialidad")?.value.trim() || "";
      const matricula = document.getElementById("medico-matricula")?.value.trim() || "";
      const contacto = document.getElementById("medico-contacto")?.value.trim() || "";

      if (!nombre || !especialidad) {
        alert("Por favor completá al menos nombre y especialidad.");
        return;
      }

      let config = cargarConfigDesdeStorage() || {};
      config.nombre = nombre;
      config.especialidad = especialidad;
      config.matricula = matricula;
      config.contacto = contacto;

      const logoInput = document.getElementById("medico-logo");
      const firmaInput = document.getElementById("medico-firma");

      try {
        if (logoInput && logoInput.files && logoInput.files[0]) {
          const logoDataUrl = await leerArchivoComoDataURL(logoInput.files[0]);
          config.logoBase64 = logoDataUrl;
        }
        if (firmaInput && firmaInput.files && firmaInput.files[0]) {
          const firmaDataUrl = await leerArchivoComoDataURL(firmaInput.files[0]);
          config.firmaBase64 = firmaDataUrl;
        }
      } catch (e) {
        console.error("Error al leer logo/firma:", e);
        alert("Hubo un problema leyendo el logo o la firma. Probá con otra imagen.");
      }

      guardarConfigEnStorage(config);
      console.log("Configuración guardada:", config);

      alert("Configuración guardada correctamente.");
      mostrarVista("informe-view");
    });
  }

  if (btnIrConfig) {
    btnIrConfig.addEventListener("click", () => {
      const config = cargarConfigDesdeStorage();
      if (config) {
        poblarFormularioConfig(config);
      }
      mostrarVista("config-view");
    });
  }

  // El botón principal ahora graba audio + IA
  if (btnGenerarInforme) {
    btnGenerarInforme.textContent = "🎙️ Grabar informe (audio + IA)";
    btnGenerarInforme.addEventListener("click", () => {
      toggleGrabacionAudio();
    });
  }


  if (btnGenerarPdf) {
    btnGenerarPdf.addEventListener("click", () => {
      generarPdf();
    });
  }
});






