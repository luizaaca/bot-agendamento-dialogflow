exports.dialogflowWebhook = (req, res) => {
  const intent = req.body.queryResult.intent.displayName;
  const params = req.body.queryResult.parameters;

  switch (intent) {
    case "VerificarAgenda":
      // Chamar função que consulta agenda
      return res.json({
        fulfillmentText: `Olá ${params.cpf}, aqui estão seus horários disponíveis: amanhã às 14h, sexta às 9h`
      });

    case "AgendarConsulta":
      // Grava agendamento
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
};
