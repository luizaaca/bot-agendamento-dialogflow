export const config = {
	HORARIO_INICIO: parseInt(process.env.HORARIO_INICIO) || 7,
	HORARIO_FIM: parseInt(process.env.HORARIO_FIM) || 21,
	SLOT_MINUTOS: parseInt(process.env.SLOT_MINUTOS) || 60,
	INTERVALO_AGENDAMENTO: parseInt(process.env.INTERVALO_AGENDAMENTO) || 3,
	DIAS_LIMITE: parseInt(process.env.DIAS_LIMITE) || 5,
	CALENDAR_ID: process.env.CALENDAR_ID ,
	LOCALE: process.env.LOCALE || "pt-BR",
	TIMEZONE: process.env.TIMEZONE || "America/Sao_Paulo",
	GOOGLE_SCOPES: process.env.GOOGLE_SCOPES ? process.env.GOOGLE_SCOPES.split(",") : ["https://www.googleapis.com/auth/calendar"],
	GOOGLE_API_VERSION: process.env.GOOGLE_API_VERSION || "v3"
};
