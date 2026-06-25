const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Initialize the document
const doc = new PDFDocument({ margin: 50 });

// Pipe the output to the data folder
const outputPath = path.join(__dirname, 'data', 'knowledge_base.pdf');
const stream = fs.createWriteStream(outputPath);
doc.pipe(stream);

// Styling and Content
doc.fontSize(24).font('Helvetica-Bold').text('Personal Knowledge Base & Rules', { align: 'center' });
doc.moveDown(2);

// Section 1
doc.fontSize(16).font('Helvetica-Bold').text('1. Scheduling & Availability');
doc.moveDown(0.5);
doc.fontSize(12).font('Helvetica').text('- I work Monday through Friday, 9 AM to 6 PM EST. I do not check emails on weekends.');
doc.text('- If someone asks to schedule a meeting, politely provide my Calendly link: calendly.com/my-name/30min.');
doc.moveDown(1.5);

// Section 2
doc.fontSize(16).font('Helvetica-Bold').text('2. Rates & Services');
doc.moveDown(0.5);
doc.fontSize(12).font('Helvetica').text('- My hourly consulting rate is $150/hr.');
doc.text('- For website development, my base project fee starts at $2,000.');
doc.text('- I only accept payments via Stripe or Direct Bank Transfer. I do not accept PayPal.');
doc.moveDown(1.5);

// Section 3
doc.fontSize(16).font('Helvetica-Bold').text('3. Personal FAQ & Boundaries');
doc.moveDown(0.5);
doc.fontSize(12).font('Helvetica').text('- If recruiters ask for my resume, thank them and provide this link: mywebsite.com/resume.pdf.');
doc.text('- If someone asks me to work for free or for "equity", politely but firmly decline.');
doc.text('- If a client emails about a server crash or technical bug, tell them I have been paged, but they must also submit a ticket to support@mywebsite.com.');
doc.moveDown(1.5);

// Section 4
doc.fontSize(16).font('Helvetica-Bold').text('4. Project Statuses');
doc.moveDown(0.5);
doc.fontSize(12).font('Helvetica').text('- I am currently fully booked for Q3. If a potential client asks for new work, politely state that I am only taking new projects starting in October.');
doc.text('- I am under a strict NDA regarding "Project Phoenix". If anyone asks about it, state that I am legally prohibited from discussing it.');
doc.moveDown(1.5);

// Section 5
doc.fontSize(16).font('Helvetica-Bold').text('5. Tone & Drafting Rules');
doc.moveDown(0.5);
doc.fontSize(12).font('Helvetica').text('- Always sound friendly, professional, and concise.');
doc.text('- Never make promises about deadlines or agree to contracts on my behalf; state that I will review it personally.');

// Finalize the PDF
doc.end();

stream.on('finish', () => {
    console.log('PDF successfully generated at:', outputPath);
});
