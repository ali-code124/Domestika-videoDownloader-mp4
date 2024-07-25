const fs = require("fs");
const axios = require("axios");
const m3u8Parser = require("m3u8-parser");
const path = require("path");
const { exec } = require("child_process");

const parseM3U8 = (filePath) => {
  // Load the M3U8 file
  const m3u8FilePath = filePath;
  const m3u8Content = fs.readFileSync(m3u8FilePath, "utf-8");

  // Parse the M3U8 file
  const parser = new m3u8Parser.Parser();
  parser.push(m3u8Content);
  parser.end();

  const parsedManifest = parser.manifest;
  return parsedManifest;
};

//download best quality video m3u8 file
const downloadM3U8File = async (url, filePath) => {
  const response = await axios.get(url);
  fs.writeFileSync(filePath, response.data);
  return response.data;
};

// Function to download a segment
const downloadSegment = async (url, outputDir, segmentIndex) => {
  const response = await axios({
    url: url,
    method: "GET",
    responseType: "stream",
  });
  const segmentPath = path.join(outputDir, `segment${segmentIndex}.ts`);
  response.data.pipe(fs.createWriteStream(segmentPath));
  return new Promise((resolve, reject) => {
    response.data.on("end", resolve);
    response.data.on("error", reject);
  });
};

// Download all segments
const downloadSegments = async (segments, outputDir) => {
  const baseUrl = `https://embed-ssl.wistia.com`;
  for (let i = 0; i < segments.length; i++) {
    const segmentUrl = `${baseUrl}${segments[i]}`;
    console.log(`Downloading segment ${i + 1} of ${segments.length}`);
    await downloadSegment(segmentUrl, outputDir, i + 1);
  }
  console.log("All segments downloaded successfully");
};

const downloadSubtitle = async (url, outputDir, subtitleIndex) => {
  const response = await axios({
    url: url,
    method: "GET",
    responseType: "stream",
  });
  const segmentPath = path.join(outputDir, `subtitle${subtitleIndex}.vtt`);
  response.data.pipe(fs.createWriteStream(segmentPath));
  return new Promise((resolve, reject) => {
    response.data.on("end", resolve);
    response.data.on("error", reject);
  });
};

const combineSubtitles = async (subtitleDir, combinedSubtitleFile) => {
  // Read all subtitle files and combine them
  const subtitleFiles = fs
    .readdirSync(subtitleDir)
    .filter((file) => file.endsWith(".vtt"));

  let combinedContent = "WEBVTT\n\n";

  subtitleFiles.forEach((file, index) => {
    const content = fs.readFileSync(path.join(subtitleDir, file), "utf-8");
    const lines = content.split("\n").slice(2); // Skip WEBVTT header
    combinedContent += `${lines.join("\n")}\n\n`;
  });

  fs.writeFileSync(combinedSubtitleFile, combinedContent);
  console.log("Subtitles combined successfully into combined.vtt");
};

const convertSubtitleToSRT = async (inputName, outputName) => {
  const subtitleFFMPEG = `ffmpeg -i ${inputName} ${outputName}`;
  exec(subtitleFFMPEG, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error converting subtitles: ${error.message}`);
      return;
    }

    console.log("Subtitles converted successfully to SRT format");
  });
};

const downloadVideos = async () => {
  const rawFilePath = path.join(__dirname, "data", "raw.m3u8");
  const parsedManifest = parseM3U8(rawFilePath);

  // VIDEOS
  const videoPlaylistM3U8 = parsedManifest.playlists;
  const bestQualityVideoM3U8 =
    videoPlaylistM3U8[videoPlaylistM3U8.length - 1].uri;

  const bestQualityManifest = await downloadM3U8File(
    bestQualityVideoM3U8,
    path.join(__dirname, "data", "best-quality.m3u8")
  );

  //SUBTITLES
  const subtitlesPlaylistM3U8 = parsedManifest.mediaGroups.SUBTITLES;
  const englishSubtitlesUrl = subtitlesPlaylistM3U8.sub1.English.uri;
  const spanishSubtitleUrl = subtitlesPlaylistM3U8.sub1.Español.uri;

  await downloadM3U8File(
    englishSubtitlesUrl,
    path.join(__dirname, "data", "subtitles_english.m3u8")
  );
  await downloadM3U8File(
    spanishSubtitleUrl,
    path.join(__dirname, "data", "subtitles_spanish.m3u8")
  );

  const parsedEnglishSubtitlesManifest = parseM3U8(
    path.join(__dirname, "data", "subtitles_english.m3u8")
  );
  const parsedSpanishSubtitlesManifest = parseM3U8(
    path.join(__dirname, "data", "subtitles_spanish.m3u8")
  );

  parsedEnglishSubtitlesManifest.segments.map(async (segment, index) => {
    await downloadSubtitle(
      segment.uri,
      path.join(__dirname, "subtitles", "english"),
      index
    );
  });
  parsedSpanishSubtitlesManifest.segments.map(async (segment, index) => {
    await downloadSubtitle(
      segment.uri,
      path.join(__dirname, "subtitles", "spanish"),
      index
    );
  });

  await combineSubtitles("./subtitles/english", "combined_english.vtt");
  await combineSubtitles("./subtitles/spanish", "combined_spanish.vtt");

  // Parse the M3U8 file and extract segment URIs
  const segmentRegex = /\/deliveries\/.*?\.ts/g;
  const segments = bestQualityManifest.match(segmentRegex);

  segments.shift();

  await downloadSegments(segments, path.join(__dirname, "videos"));

  const segmentFiles = fs
    .readdirSync("videos")
    .filter((file) => file.endsWith(".ts"))
    .sort((a, b) => {
      const aIndex = parseInt(a.match(/segment(\d+)\.ts/)[1]);
      const bIndex = parseInt(b.match(/segment(\d+)\.ts/)[1]);
      return aIndex - bIndex;
    });

  const fileListContent = segmentFiles
    .map((file) => `file '${path.join("videos", file)}'`)
    .join("\n");
  fs.writeFileSync("filelist.txt", fileListContent);

  // Convert subtitles to SRT format
  await convertSubtitleToSRT("combined_english.vtt", "combined_english.srt");
  await convertSubtitleToSRT("combined_spanish.vtt", "combined_spanish.srt");

  // Run ffmpeg to merge the segments and convert to MP4
  const ffmpegCommandWithSubtitle = `ffmpeg -f concat -safe 0 -i filelist.txt -i combined_english.srt -i combined_spanish.srt \
  -c:v copy -c:a copy -c:s mov_text \
  -metadata:s:s:0 language=eng -metadata:s:s:0 title="English" \
  -metadata:s:s:1 language=spa -metadata:s:s:1 title="Spanish" \
  -map 0:v -map 0:a -map 1 -map 2 \
  output.mp4`;
  // const ffmpegCommand = `ffmpeg -f concat -safe 0 -i filelist.txt -c copy output.mp4`;
  exec(ffmpegCommandWithSubtitle, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error merging video segments: ${error.message}`);
      return;
    }

    console.log("Video segments merged successfully into output.mp4");
  });
};

downloadVideos();
