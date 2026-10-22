import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOutgoingMessage,
  defaultMailBody,
  greetingName,
  mailAttachmentName,
  mailBodyHtml,
  mailSubject,
  titleCaseName,
} from "../src/utils/mailMessage.js";
import { logoPixelSize } from "../src/utils/estimatePdf.js";

const estimateFile = "Est 528 - JOHN SMITH.xlsx";
const invoiceFile = "Inv 510 - ACME CORP - Ref 528.xlsx";

test("subjects name the document and leave the filename out", () => {
  assert.equal(mailSubject({ kind: "estimate", fileName: estimateFile }), "Estimate #528 from Disposal Solutions");
  assert.equal(mailSubject({ kind: "invoice", fileName: invoiceFile }), "Invoice #510 from Disposal Solutions");
  assert.equal(mailSubject({ kind: "estimate", fileName: estimateFile }).includes("JOHN"), false);
  assert.equal(mailSubject({ kind: "estimate", fileName: estimateFile }).includes(".pdf"), false);
  assert.equal(mailSubject({ kind: "invoice", fileName: invoiceFile }).includes("528"), false);
});

test("the attachment name is calm and the saved file name is separate", () => {
  assert.equal(
    mailAttachmentName({ kind: "estimate", fileName: estimateFile }),
    "Estimate 528 - Disposal Solutions.pdf"
  );
  assert.equal(
    mailAttachmentName({ kind: "invoice", fileName: invoiceFile }),
    "Invoice 510 - Disposal Solutions.xlsx"
  );
  assert.equal(mailAttachmentName({ kind: "estimate", fileName: estimateFile }).includes("JOHN"), false);
  assert.notEqual(mailAttachmentName({ kind: "estimate", fileName: estimateFile }), estimateFile);
});

test("the default message greets the customer in title case and stays editable text", () => {
  assert.equal(titleCaseName("JOHN SMITH"), "John Smith");
  assert.equal(titleCaseName("mary-jane o'neil"), "Mary-Jane O'Neil");
  assert.equal(greetingName("JOHN SMITH"), "John");
  const estimate = defaultMailBody({ kind: "estimate", fileName: estimateFile, customerName: "JOHN SMITH" });
  assert.match(estimate, /^Hi John,/);
  assert.match(estimate, /Your estimate #528 is attached/);
  assert.match(estimate, /would like to go ahead/);
  assert.match(estimate, /Thanks,\nChad\nDisposal Solutions\n416-889-5284\n705-707-6064\ndisposalsolutions@outlook.com$/);
  assert.equal(estimate.includes("JOHN"), false);
  assert.equal(estimate.includes(".pdf"), false);

  const invoice = defaultMailBody({ kind: "invoice", fileName: invoiceFile, customerName: "ACME CORP" });
  assert.match(invoice, /^Hi Acme,/);
  assert.match(invoice, /Your invoice #510 is attached/);
  assert.match(invoice, /payment/i);
  assert.match(invoice, /416-889-5284\n705-707-6064\ndisposalsolutions@outlook.com$/);
  assert.equal(defaultMailBody({ kind: "estimate", fileName: "Est 1 - .xlsx", customerName: "" }).startsWith("Hi,"), true);
});

test("the sent message is HTML from the plain text, with a display name and reply address", () => {
  const html = mailBodyHtml("Hi John,\n\nThanks.\nChad");
  assert.match(html, /<p/);
  assert.match(html, /Hi John,/);
  assert.match(html, /Thanks\.<br>Chad/);
  assert.equal(html.includes("<script"), false);
  const escaped = mailBodyHtml("a < b & c");
  assert.match(escaped, /a &lt; b &amp; c/);

  const message = buildOutgoingMessage({
    fromAddress: "disposalsolutions@outlook.com",
    subject: "Estimate #528 from Disposal Solutions",
    body: defaultMailBody({ kind: "estimate", fileName: estimateFile, customerName: "JOHN SMITH" }),
    to: "customer@example.com",
    cc: "office@example.com",
    fileName: "Estimate 528 - Disposal Solutions.pdf",
    contentType: "application/octet-stream",
    contentBytes: "YQ==",
  });
  assert.equal(message.body.contentType, "HTML");
  assert.match(message.body.content, /Hi John,/);
  assert.equal(message.from.emailAddress.name, "Disposal Solutions");
  assert.equal(message.from.emailAddress.address, "disposalsolutions@outlook.com");
  assert.equal(message.replyTo[0].emailAddress.name, "Disposal Solutions");
  assert.equal(message.replyTo[0].emailAddress.address, "disposalsolutions@outlook.com");
  assert.equal(message.attachments[0].name, "Estimate 528 - Disposal Solutions.pdf");
  assert.equal(message.attachments[0].contentType, "application/pdf");
  assert.equal(message.toRecipients[0].emailAddress.address, "customer@example.com");
  assert.equal(message.ccRecipients[0].emailAddress.address, "office@example.com");
});

test("a huge logo is drawn smaller while a small logo stays as it is", () => {
  assert.deepEqual(logoPixelSize(1536, 1024), { width: 400, height: 267 });
  assert.deepEqual(logoPixelSize(200, 80), { width: 200, height: 80 });
});
