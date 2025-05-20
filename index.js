const { obterHorariosDisponiveis } = require('./calendarService');

async function dialogflowWebhook(req, res) {
  const intent = req.body.queryResult.intent.displayName;
  const params = req.body.queryResult.parameters;
  const cpf = params?.cpf;

  switch (intent) {
    case "VerificarAgenda":
      try {
        const horarios = await obterHorariosDisponiveis();
        return res.json({
          fulfillmentText: `Horários disponíveis: ${horarios.join(', ')}`
        });
      } catch (err) {
        console.error(err);
        return res.json({ fulfillmentText: "Ocorreu um erro ao acessar a agenda." });
      }

    case "AgendarConsulta":
      // Grava agendamento
      if (!cpf) {
        return res.json({ fulfillmentText: "Por favor, informe seu CPF para continuar." });
      }
      return res.json({
        fulfillmentText: `Consulta agendada para ${params.data} às ${params.hora}`
      });

    case "CancelarAgendamento":
      // Cancela o agendamento do paciente
      return res.json({
        fulfillmentText: "Sua consulta foi cancelada com sucesso."
      });

    case "ConsultarAgendamento":
      // Mostra agendamento atual
      return res.json({
        fulfillmentText: "Sua próxima consulta é na sexta às 14h."
      });

    default:
      return res.json({
        fulfillmentText: "Desculpe, não entendi a solicitação."
      });
  }
}

functions.http('dialogflowWebhook', dialogflowWebhook);
