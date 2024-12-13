const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// Serve static files from 'public' directory
app.use(express.static('public'));
app.use(express.json());

// Store results temporarily
const results = new Map();

// Routes
app.post('/api/scrape', async (req, res) => {
    try {
        const { storeId, option } = req.body;
        
        // Generate unique ID for this job
        const jobId = Date.now().toString();
        
        // Run scraper asynchronously
        processScrapeRequest(jobId, storeId, option);
        
        res.json({ jobId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/status/:jobId', (req, res) => {
    const jobId = req.params.jobId;
    const result = results.get(jobId);
    
    if (!result) {
        res.json({ status: 'processing' });
        return;
    }
    
    res.json(result);
});

app.get('/api/download/:jobId', (req, res) => {
    const jobId = req.params.jobId;
    const result = results.get(jobId);
    
    if (!result || !result.filePath) {
        res.status(404).send('File not found');
        return;
    }
    
    res.download(result.filePath);
});

async function processScrapeRequest(jobId, storeId, option) {
    try {
        // Import your existing scraper functionality
        const { batchProcessByParent } = require('./scraper');
        
        // Process the request
        const filePath = await batchProcessByParent(storeId);
        
        // Store the result
        results.set(jobId, {
            status: 'complete',
            filePath
        });
        
        // Clean up old results after 1 hour
        setTimeout(() => {
            results.delete(jobId);
        }, 3600000);
        
    } catch (error) {
        results.set(jobId, {
            status: 'error',
            error: error.message
        });
    }
}

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 