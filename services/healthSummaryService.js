// services/ollamaService.js
import axios from 'axios';

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL_NAME = 'deepseek-r1:8b';

class OllamaService {
  constructor() {
    this.client = axios.create({
      baseURL: OLLAMA_BASE_URL,
      timeout: 1200000, // 2 minutes timeout for AI processing
    });
  }

  // Check if Ollama is running and model is available
  async checkHealth() {
    try {
      const response = await this.client.get('/api/tags');
      const models = response.data.models || [];
      const hasModel = models.some(m => m.name.includes('deepseek-r1'));
      
      return {
        isRunning: true,
        hasModel,
        availableModels: models.map(m => m.name),
      };
    } catch (error) {
      return {
        isRunning: false,
        hasModel: false,
        error: error.message,
      };
    }
  }

  // Generate lab report summary
  async summarizeLabReport(labReportData) {
    try {
      const prompt = this.buildLabReportPrompt(labReportData);

      const response = await this.client.post('/api/generate', {
        model: MODEL_NAME,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.3, // Lower temperature for more focused/accurate responses
          top_p: 0.9,
          top_k: 40,
        },
      });

      return {
        success: true,
        summary: response.data.response,
        model: MODEL_NAME,
        processingTime: response.data.total_duration,
      };
    } catch (error) {
      console.error('Ollama summarization error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Generate streaming summary (for real-time response)
  async summarizeLabReportStream(labReportData, onChunk) {
    try {
      const prompt = this.buildLabReportPrompt(labReportData);

      console.log('🤖 Calling Ollama API...');
      console.log('📝 Prompt length:', prompt.length, 'chars');

      const response = await this.client.post(
        '/api/generate',
        {
          model: MODEL_NAME,
          prompt: prompt,
          stream: true,
          options: {
            temperature: 0.3,
            top_p: 0.9,
            top_k: 40,
            num_predict: 2048, // Limit response length
          },
        },
        {
          responseType: 'stream',
        }
      );

      console.log('📡 Ollama stream started');

      let fullResponse = '';
      let chunkCount = 0;
      let buffer = '';

      return new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          
          // Keep the last incomplete line in buffer
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              const data = JSON.parse(line);
              
              if (data.response) {
                chunkCount++;
                fullResponse += data.response;
                onChunk(data.response);
                
                if (chunkCount % 20 === 0) {
                  console.log(`🔄 Ollama: ${chunkCount} chunks, ${fullResponse.length} chars`);
                }
              }

              if (data.done === true) {
                console.log('✅ Ollama marked stream as done');
              }

              if (data.error) {
                console.error('❌ Ollama error:', data.error);
                reject(new Error(data.error));
              }
            } catch (parseError) {
              console.warn('⚠️ Failed to parse Ollama response:', line.substring(0, 100));
            }
          }
        });

        response.data.on('end', () => {
          console.log(`✅ Ollama stream ended: ${chunkCount} chunks, ${fullResponse.length} chars`);
          
          if (fullResponse.length === 0) {
            reject(new Error('No response received from Ollama'));
          } else {
            resolve(fullResponse);
          }
        });

        response.data.on('error', (error) => {
          console.error('❌ Ollama stream error:', error);
          reject(error);
        });
      });
    } catch (error) {
      console.error('❌ Ollama API error:', error);
      
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Cannot connect to Ollama. Is it running on http://localhost:11434?');
      }
      
      throw error;
    }
  }

  // Build prompt for lab report analysis
  buildLabReportPrompt(labReportData) {
    console.log("Building prompt with lab report data:", labReportData);
    const {
      report_name,
      report_date,
      test_results,
      additional_notes,
      patient_age,
      patient_gender,
    } = labReportData;
    console.log("String:d" ,JSON.stringify(test_results, null, 2));

    return `
You are generating a clinical summary for a Health Information System.

STRICT OUTPUT RULES (MUST FOLLOW):
- Do NOT write introductions like "Here is", "This report shows", "Based on", etc.
- Do NOT address the reader.
- Do NOT explain what you are doing.
- Do NOT restate report name or metadata unless medically relevant.
- Output must start immediately with the clinical content.
- Use a professional medical tone, not conversational AI tone.
- Ignore any null, undefined, or missing values.
- Do NOT add conclusions outside the requested sections.

OUTPUT FORMAT (follow exactly):

Overview:
<direct summary>

Key Findings:
- ...

Normal vs Abnormal:
- ...

Clinical Significance:
...

Recommendations:
...

Important Notes:
...

Lab Data: (This is only raw data, do NOT include it in the summary)
Report Name: ${report_name}
Report Date: ${report_date}
Patient Age: ${patient_age || 'Not specified'}
Patient Gender: ${patient_gender || 'Not specified'}

Test Results (JSON):
${JSON.stringify(test_results, null, 2)}

Additional Notes:
${additional_notes || 'None'}
`;
  }

  // Generate insights for specific test values
  async analyzeTestValue(testName, value, normalRange, unit) {
    try {
      const prompt = `As a medical AI, analyze this lab test result:

Test: ${testName}
Value: ${value} ${unit}
Normal Range: ${normalRange}

Provide:
1. Is this value normal, high, or low?
2. What does this value indicate?
3. What could cause this result?
4. Should the patient be concerned?

Keep the response concise (2-3 sentences).`;

      const response = await this.client.post('/api/generate', {
        model: MODEL_NAME,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.2,
          max_tokens: 200,
        },
      });

      return {
        success: true,
        analysis: response.data.response,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Compare multiple lab reports
  async compareLabReports(reports) {
    try {
      const prompt = `Compare these lab reports and identify trends:

${reports.map((report, index) => `
Report ${index + 1} (${report.report_date}):
${JSON.stringify(report.test_results, null, 2)}
`).join('\n')}

Provide:
1. Trends over time (improving, worsening, stable)
2. Key changes between reports
3. Areas of concern
4. Positive developments

Keep it concise and actionable.`;

      const response = await this.client.post('/api/generate', {
        model: MODEL_NAME,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.3,
        },
      });

      return {
        success: true,
        comparison: response.data.response,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

export default new OllamaService();