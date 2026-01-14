import { query, transaction } from "../config/database.js";

import {
  uploadToCloudinary,
  deleteFromCloudinary,
  getCloudinaryUrl,
} from "../middleware/upload.js";
import { extractTextFromImage } from "../services/ocrServices.js";
import { structureLabData } from "../services/structuredOCR.js";

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
