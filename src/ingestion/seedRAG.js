require('dotenv').config();
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { OpenAIEmbeddings } = require("@langchain/openai");
const fs = require('fs');
const path = require('path');

async function seedRAG() {
    console.log("=== STARTING VECTOR DATABASE SEEDING ===");
    
    // 1. Load the PDF
    const pdfPath = path.join(__dirname, '../../data/knowledge_base.pdf');
    console.log(`[1/4] Loading PDF from ${pdfPath}...`);
    const loader = new PDFLoader(pdfPath);
    const docs = await loader.load();
    
    // 2. Split into chunks
    console.log(`[2/4] Splitting text into readable chunks...`);
    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 500,
        chunkOverlap: 50,
    });
    const splitDocs = await splitter.splitDocuments(docs);
    console.log(`Created ${splitDocs.length} vector chunks.`);

    // 3. Initialize Embeddings
    console.log(`[3/4] Initializing text-embedding-3-small...`);
    const embeddings = new OpenAIEmbeddings({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "text-embedding-3-small",
    });

    // 4. Extract text and embed each chunk directly into JSON
    console.log(`[4/4] Generating embeddings and saving to data/memory_vectors.json...`);
    try {
        const texts = splitDocs.map(doc => doc.pageContent);
        const vectors = await embeddings.embedDocuments(texts);
        
        // Combine text and their corresponding vector
        const db = texts.map((text, index) => ({
            text: text,
            embedding: vectors[index]
        }));
        
        const savePath = path.join(__dirname, '../config/memory_vectors.json');
        fs.writeFileSync(savePath, JSON.stringify(db, null, 2));
        
        console.log(`✅ Successfully seeded pure local Vector Database! Saved to ${savePath}`);
    } catch (e) {
        console.error("❌ Failed to create vector store.", e);
    }
}

seedRAG();
