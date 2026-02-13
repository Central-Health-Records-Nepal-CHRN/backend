import { query, transaction } from "../config/database.js";

import {
  uploadToCloudinary,
  deleteFromCloudinary,
  getCloudinaryUrl,
} from "../middleware/upload.js";
import { extractTextFromImage } from "../services/ocrServices.js";
import { structureLabData } from "../services/structuredOCR.js";
import ollamaService from "../services/healthSummaryService.js";

/* =========================================================
   GET ALL LAB REPORTS (PAGINATED)
========================================================= */
export const getLabReports = async (req, res) => {
  try {
    const userId = req.user?.userId;
    console.log("Fetching reports for user:", userId);
    const {
      page = 1,
      limit = 10,
      sortBy = "report_date",
      order = "DESC",
    } = req.query;

    const offset = (page - 1) * limit;

    const reportsResult = await query(
      `
      SELECT lr.*, COUNT(lt.id) AS test_count
      FROM lab_reports lr
      LEFT JOIN lab_tests lt ON lr.id = lt.report_id
      WHERE lr.user_id = $1
      GROUP BY lr.id
      ORDER BY ${sortBy} ${order}
      LIMIT $2 OFFSET $3
      `,
      [userId, limit, offset]
    );

    const reports = reportsResult.rows.map((report) => {
      if (report.image_key) {
        report.image_url = getCloudinaryUrl(report.image_key);
      }
      return report;
    });

    const countResult = await query(
      "SELECT COUNT(*) FROM lab_reports WHERE user_id = $1",
      [userId]
    );

    res.json({
      success: true,
      data: reports,
      pagination: {
        total: Number(countResult.rows[0].count),
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(countResult.rows[0].count / limit),
      },
    });
  } catch (error) {
    console.error("Get reports error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch reports" });
  }
};

/* =========================================================
   GET SINGLE LAB REPORT
========================================================= */
export const getLabReportById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const reportResult = await query(
      "SELECT * FROM lab_reports WHERE id = $1 AND user_id = $2",
      [id, userId]
    );

    if (!reportResult.rows.length) {
      return res
        .status(404)
        .json({ success: false, message: "Report not found" });
    }

    const report = reportResult.rows[0];

    if (report.image_key) {
      report.image_url = getCloudinaryUrl(report.image_key);
    }

    const testsResult = await query(
      "SELECT * FROM lab_tests WHERE report_id = $1 ORDER BY order_index ASC",
      [id]
    );

    res.json({
      success: true,
      data: {
        ...report,
        tests: testsResult.rows,
      },
    });
  } catch (error) {
    console.error("Get report error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch report" });
  }
};

/* =========================================================
   CREATE LAB REPORT
========================================================= */
export const createLabReport = async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log("Creating report for user:", userId);

    const { lab_name, report_date, notes, status = "draft" } = req.body;

    const result = await query(
      `
      INSERT INTO lab_reports (user_id, lab_name, report_date, notes, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [userId, lab_name, report_date, notes, status]
    );

    res.status(201).json({
      success: true,
      message: "Lab report created",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Create report error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to create report" });
  }
};

/* =========================================================
   UPLOAD IMAGE + OCR
========================================================= */

// controllers/labReportController.js

export const uploadReportImage = async (req, res) => {
  let uploadedKey = null;
  
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: "Image required" 
      });
    }

    const reportResult = await query(
      "SELECT image_key FROM lab_reports WHERE id = $1 AND user_id = $2",
      [id, userId]
    );

    if (!reportResult.rows.length) {
      return res.status(404).json({ 
        success: false, 
        message: "Report not found" 
      });
    }

    const oldImageKey = reportResult.rows[0].image_key;

    // Upload to Cloudinary
    console.log("📤 Uploading to Cloudinary...");
    const { url, key } = await uploadToCloudinary(req.file, userId);
    uploadedKey = key;

    // Update report with image URL immediately
    await query(
      "UPDATE lab_reports SET image_url = $1, image_key = $2, updated_at = NOW() WHERE id = $3",
      [url, key, id]
    );

    // Create or update processing status record
    await query(
      `INSERT INTO ocr_processing_status (report_id, status, progress)
       VALUES ($1, 'processing', 0)
       ON CONFLICT (report_id) DO UPDATE 
       SET status = 'processing', progress = 0, updated_at = NOW()`,
      [id]
    );

    console.log("✅ Image uploaded, starting background OCR processing...");

    // Respond immediately
    res.json({
      success: true,
      message: "Image uploaded successfully. OCR processing started.",
      data: {
        image_url: url,
        report_id: id,
        status: "processing"
      },
    });

    // Process OCR in background
    processOCRInBackground(id, url, oldImageKey).catch(err => {
      console.error("Background OCR error:", err);
    });

  } catch (error) {
    console.error("❌ Upload error:", error);
    
    if (uploadedKey) {
      deleteFromCloudinary(uploadedKey).catch(err =>
        console.warn("Failed to cleanup image:", err)
      );
    }
    
    res.status(500).json({
      success: false,
      message: "Upload failed",
      error: error.message,
    });
  }
};

// Background processing function
async function processOCRInBackground(reportId, imageUrl, oldImageKey) {
  const start = Date.now();
  let testsArray = [];
  let errorMessage = null;

  try {
    // Update progress: Starting OCR
    await query(
      "UPDATE ocr_processing_status SET progress = 10, updated_at = NOW() WHERE report_id = $1",
      [reportId]
    );

    console.log("🔍 Starting OCR extraction...");
    const extractedText = await extractTextFromImage(imageUrl);
    
    if (!extractedText.success || !extractedText.text) {
      throw new Error("Text extraction failed");
    }

    // Update progress: OCR complete, starting LLM
    await query(
      "UPDATE ocr_processing_status SET progress = 50, updated_at = NOW() WHERE report_id = $1",
      [reportId]
    );

    console.log(`🤖 Starting LLM structuring (text length: ${extractedText.text.length})...`);
    
    try {
      const ocrResult = await structureLabData(extractedText);
      testsArray = (Array.isArray(ocrResult) ? ocrResult : []).filter(
        (test) => test && test.test_name && test.test_name.trim().length > 0
      );
    } catch (llmError) {
      console.warn("⚠️ LLM failed, using fallback parser:", llmError.message);
      errorMessage = llmError.message;
      
      const { fallbackStructureLabData } = await import('../services/structuredOCR.js');
      const fallbackResult = fallbackStructureLabData(extractedText);
      testsArray = fallbackResult;
    }

    const processingTime = Date.now() - start;
    const testsCount = testsArray.length;
    const ocrSuccess = testsCount > 0;

    // Update progress: Saving to database
    await query(
      "UPDATE ocr_processing_status SET progress = 90, updated_at = NOW() WHERE report_id = $1",
      [reportId]
    );

    // Save results to database
    await transaction(async (client) => {
      // Insert OCR log
      await client.query(
        `INSERT INTO ocr_logs
         (report_id, image_url, extracted_text, tests_extracted, status, processing_time_ms, error_message)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          reportId,
          imageUrl,
          extractedText.text || "",
          testsCount,
          ocrSuccess ? "success" : "failed",
          processingTime,
          errorMessage
        ]
      );

      // Insert lab tests
      if (testsArray.length > 0) {
        for (let i = 0; i < testsArray.length; i++) {
          const test = testsArray[i];
          await client.query(
            `INSERT INTO lab_tests
             (report_id, test_name, value, unit, normal_range, order_index)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              reportId,
              test.test_name,
              test.result ?? null,
              test.units ?? null,
              test.reference_range ?? null,
              i
            ]
          );
        }
      }
    });

    // Mark as completed
    await query(
      "UPDATE ocr_processing_status SET status = 'completed', progress = 100, updated_at = NOW() WHERE report_id = $1",
      [reportId]
    );

    // Delete old image
    if (oldImageKey) {
      await deleteFromCloudinary(oldImageKey).catch(console.warn);
    }

    console.log(`✅ Background OCR completed: ${testsCount} tests extracted in ${processingTime}ms`);

  } catch (error) {
    console.error("❌ Background OCR error:", error);
    
    await query(
      `UPDATE ocr_processing_status 
       SET status = 'failed', error_message = $1, updated_at = NOW() 
       WHERE report_id = $2`,
      [error.message, reportId]
    );
  }
}

// New endpoint to check processing status
export const getOCRStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Verify user owns this report
    const reportCheck = await query(
      "SELECT id FROM lab_reports WHERE id = $1 AND user_id = $2",
      [id, userId]
    );

    if (!reportCheck.rows.length) {
      return res.status(404).json({ 
        success: false, 
        message: "Report not found" 
      });
    }

    // Get processing status
    const statusResult = await query(
      "SELECT status, progress, error_message, updated_at FROM ocr_processing_status WHERE report_id = $1",
      [id]
    );

    if (!statusResult.rows.length) {
      return res.json({
        success: true,
        data: {
          status: "not_started",
          progress: 0
        }
      });
    }

    const status = statusResult.rows[0];

    // If completed, get the tests
    let tests = [];
    if (status.status === 'completed') {
      const testsResult = await query(
        "SELECT * FROM lab_tests WHERE report_id = $1 ORDER BY order_index",
        [id]
      );
      tests = testsResult.rows;
    }

    res.json({
      success: true,
      data: {
        status: status.status,
        progress: status.progress,
        error_message: status.error_message,
        updated_at: status.updated_at,
        tests: tests
      }
    });

  } catch (error) {
    console.error("Status check error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check status",
      error: error.message
    });
  }
};
/* =========================================================
   UPDATE LAB REPORT
========================================================= */
export const updateLabReport = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { lab_name, report_date, notes, status } = req.body;

    const result = await query(
      `
      UPDATE lab_reports
      SET lab_name = COALESCE($1, lab_name),
          report_date = COALESCE($2, report_date),
          notes = COALESCE($3, notes),
          status = COALESCE($4, status)
      WHERE id = $5 AND user_id = $6
      RETURNING *
      `,
      [lab_name, report_date, notes, status, id, userId]
    );

    if (!result.rows.length) {
      return res
        .status(404)
        .json({ success: false, message: "Report not found" });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: "Update failed" });
  }
};

/* =========================================================
   DELETE LAB REPORT
========================================================= */
export const deleteLabReport = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const result = await query(
      "SELECT image_key FROM lab_reports WHERE id = $1 AND user_id = $2",
      [id, userId]
    );

    if (!result.rows.length) {
      return res
        .status(404)
        .json({ success: false, message: "Report not found" });
    }

    if (result.rows[0].image_key) {
      await deleteFromCloudinary(result.rows[0].image_key);
    }

    await query("DELETE FROM lab_reports WHERE id = $1 AND user_id = $2", [
      id,
      userId,
    ]);

    res.json({ success: true, message: "Report deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Delete failed" });
  }
};

/* =========================================================
   UPDATE TESTS MANUALLY
========================================================= */
export const updateTests = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { tests } = req.body;

    if (!Array.isArray(tests)) {
      return res.status(400).json({ success: false, message: "Invalid tests" });
    }

    const reportCheck = await query(
      "SELECT id FROM lab_reports WHERE id = $1 AND user_id = $2",
      [id, userId]
    );

    if (!reportCheck.rows.length) {
      return res
        .status(404)
        .json({ success: false, message: "Report not found" });
    }

    await transaction(async (client) => {
      await client.query("DELETE FROM lab_tests WHERE report_id = $1", [id]);

      for (let i = 0; i < tests.length; i++) {
        const t = tests[i];
        await client.query(
          `
          INSERT INTO lab_tests
          (report_id, test_name, value, unit, normal_range, order_index)
          VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [id, t.test_name, t.value, t.unit, t.normal_range, i]
        );
      }
    });

    res.json({ success: true, message: "Tests updated" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Update tests failed" });
  }
};




// Generate AI summary for lab report
export const generateLabReportSummary = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { reportId } = req.params;

    // Get lab report
    const reportResult = await query(
      `SELECT * FROM lab_reports WHERE id = $1 AND user_id = $2`,
      [reportId, userId]
    );

    if (reportResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lab report not found',
      });
    }

    const report = reportResult.rows[0];

    const testResults = await query(
      `SELECT test_name, value, unit, normal_range 
       FROM lab_tests
        WHERE report_id = $1
    `,
      [reportId]
    );

    console.log(testResults.rows);
    if (testResults.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No test results found for this report',
      });
    }

    // Check if Ollama is available
    const health = await ollamaService.checkHealth();
    if (!health.isRunning) {
      return res.status(503).json({
        success: false,
        message: 'AI service is not available. Please ensure Ollama is running.',
        details: health.error,
      });
    }

    if (!health.hasModel) {
      return res.status(503).json({
        success: false,
        message: 'DeepSeek R1 model is not available. Please pull the model first.',
        availableModels: health.availableModels,
      });
    }

    // Get user info for context
    const userResult = await query(
      'SELECT date_of_birth, gender FROM "user" WHERE id = $1',
      [userId]
    );

    const user = userResult.rows[0];
    const patientAge = user.date_of_birth
      ? new Date().getFullYear() - new Date(user.date_of_birth).getFullYear()
      : null;

    // Prepare lab report data
    const labReportData = {
      report_name: report.lab_name,
      report_date: report.report_date,
      test_results: testResults.rows,
      additional_notes: report.additional_notes,
      patient_age: patientAge,
      patient_gender: user.gender,
    };

    console.log("Generating summary with lab report data:", labReportData);
    // Generate summary
    const summaryResult = await ollamaService.summarizeLabReport(labReportData);
    console.log("Summary result:", summaryResult);

    if (!summaryResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate summary',
        error: summaryResult.error,
      });
    }

    // Save summary to database
    await query(
      `UPDATE lab_reports 
       SET ai_summary = $1, 
           ai_summary_generated_at = CURRENT_TIMESTAMP 
       WHERE id = $2`,
      [summaryResult.summary, reportId]
    );

    res.json({
      success: true,
      data: {
        summary: summaryResult.summary,
        model: summaryResult.model,
        report_id: reportId,
      },
    });
  } catch (error) {
    console.error('Generate lab report summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate summary',
      error: error.message,
    });
  }
};

// Stream AI summary generation
// controllers/labReportsController.js

export const streamLabReportSummary = async (req, res) => {
  console.log('🎯 Stream summary endpoint hit');
  console.log('📋 Report ID:', req.params.reportId);
  console.log('👤 User ID:', req.user.userId);

  try {
    const userId = req.user.userId;
    const { reportId } = req.params;

    // Get lab report basic info
    const reportResult = await query(
      `SELECT lr.*, u.date_of_birth, u.gender 
       FROM lab_reports lr
       JOIN "user" u ON lr.user_id = u.id
       WHERE lr.id = $1 AND lr.user_id = $2`,
      [reportId, userId]
    );

    if (reportResult.rows.length === 0) {
      console.error('❌ Lab report not found');
      return res.status(404).json({
        success: false,
        message: 'Lab report not found',
      });
    }

    const report = reportResult.rows[0];
    console.log('✅ Found report:', report.lab_name);

    // Get test results from lab_tests table
    const testResults = await query(
      `SELECT test_name, value, unit, normal_range
       FROM lab_tests
       WHERE report_id = $1
       ORDER BY test_name`,
      [reportId]
    );

    console.log('📊 Found', testResults.rows.length, 'test results');

    if (testResults.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No test results found in this report',
      });
    }

    // Calculate patient age
    const patientAge = report.date_of_birth
      ? new Date().getFullYear() - new Date(report.date_of_birth).getFullYear()
      : null;

    const labReportData = {
      report_name: report.lab_name,
      report_date: report.report_date,
      test_results: testResults.rows,
      additional_notes: report.notes,
      patient_age: patientAge,
      patient_gender: report.gender,
    };

    console.log('📝 Lab report data prepared');
    console.log('🧪 Tests to analyze:', testResults.rows.length);

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering if behind nginx
    });

    // Send initial ping to establish connection
    res.write(': connected\n\n');
    if (res.flush) res.flush();

    console.log('📡 SSE connection established');

    let fullSummary = '';
    let chunkCount = 0;

    // Keep-alive ping to prevent timeout
    const keepAliveInterval = setInterval(() => {
      res.write(': keep-alive\n\n');
      if (res.flush) res.flush();
    }, 15000); // Every 15 seconds

    try {
      console.log('🤖 Starting Ollama streaming...');

      // Stream summary from Ollama
      await ollamaService.summarizeLabReportStream(labReportData, (chunk) => {
        chunkCount++;
        fullSummary += chunk;

        // Send chunk to client
        const message = JSON.stringify({ chunk, done: false });
        res.write(`data: ${message}\n\n`);
        
        // Force flush to send immediately
        if (res.flush) res.flush();

        if (chunkCount % 10 === 0) {
          console.log(`📤 Sent ${chunkCount} chunks, ${fullSummary.length} chars`);
        }
      });

      clearInterval(keepAliveInterval);

      console.log(`✅ Streaming complete: ${chunkCount} chunks, ${fullSummary.length} chars`);

      // Save full summary to database
      await query(
        `UPDATE lab_reports 
         SET ai_summary = $1, 
             ai_summary_generated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [fullSummary, reportId]
      );

      console.log('💾 Summary saved to database');

      // Send completion message
      const doneMessage = JSON.stringify({ 
        chunk: '', 
        done: true, 
        summary: fullSummary,
        totalChunks: chunkCount,
        totalLength: fullSummary.length
      });
      res.write(`data: ${doneMessage}\n\n`);
      
      if (res.flush) res.flush();

      // End the stream
      res.end();
      
      console.log('✅ Stream ended successfully');

    } catch (streamError) {
      clearInterval(keepAliveInterval);
      console.error('❌ Streaming error:', streamError);
      
      // Send error to client
      const errorMessage = JSON.stringify({ 
        error: streamError.message || 'Streaming failed',
        done: true 
      });
      res.write(`data: ${errorMessage}\n\n`);
      
      if (res.flush) res.flush();
      res.end();
    }

  } catch (error) {
    console.error('❌ Stream setup error:', error);
    console.error('Error stack:', error.stack);
    
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to start streaming',
        error: error.message,
      });
    } else {
      const errorMessage = JSON.stringify({ 
        error: error.message || 'Unknown error',
        done: true 
      });
      res.write(`data: ${errorMessage}\n\n`);
      res.end();
    }
  }
};

// Analyze specific test value
export const analyzeTestValue = async (req, res) => {
  try {
    const { testName, value, normalRange, unit } = req.body;

    if (!testName || !value || !normalRange) {
      return res.status(400).json({
        success: false,
        message: 'Test name, value, and normal range are required',
      });
    }

    const result = await ollamaService.analyzeTestValue(
      testName,
      value,
      normalRange,
      unit || ''
    );

    res.json(result);
  } catch (error) {
    console.error('Analyze test value error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze test value',
    });
  }
};

// Compare multiple lab reports
export const compareLabReports = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { reportIds } = req.body;

    if (!reportIds || !Array.isArray(reportIds) || reportIds.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'At least 2 report IDs are required for comparison',
      });
    }

    // Get all reports
    const reportsResult = await query(
      `SELECT * FROM lab_reports 
       WHERE id = ANY($1) AND user_id = $2 
       ORDER BY report_date ASC`,
      [reportIds, userId]
    );

    if (reportsResult.rows.length < 2) {
      return res.status(404).json({
        success: false,
        message: 'Not enough reports found for comparison',
      });
    }

    const reports = reportsResult.rows.map(r => ({
      report_date: r.report_date,
      test_results: r.test_results,
      report_name: r.report_name,
    }));

    const result = await ollamaService.compareLabReports(reports);

    res.json(result);
  } catch (error) {
    console.error('Compare lab reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to compare reports',
    });
  }
};

// Check Ollama service health
export const checkOllamaHealth = async (req, res) => {
  try {
    const health = await ollamaService.checkHealth();
    res.json({
      success: true,
      data: health,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to check Ollama health',
    });
  }
};
