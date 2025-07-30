const Project = require('../models/Project');
const User = require('../models/User');
const FrontendLink = require('../models/FrontendLink');
const Spreadsheet = require('../models/Spreadsheet');
const XLSX = require('xlsx');

const createProject = async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required' });

  try {
    const project = new Project({
      name,
      userId: req.userId,
      links: [],
    });
    await project.save();
    res.status(201).json(project);
  } catch (error) {
    console.error('createProject: Error creating project', error);
    res.status(500).json({ error: 'Error creating project', details: error.message });
  }
};

const getProjects = async (req, res) => {
  try {
    const projects = await Project.find({ userId: req.userId });
    res.json(projects);
  } catch (error) {
    console.error('getProjects: Error fetching projects', error);
    res.status(500).json({ error: 'Error fetching projects', details: error.message });
  }
};

const deleteProject = async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    await FrontendLink.deleteMany({ projectId });
    await Spreadsheet.deleteMany({ projectId });
    await Project.deleteOne({ _id: projectId, userId: req.userId });
    res.json({ message: 'Project deleted' });
  } catch (error) {
    console.error('deleteProject: Error deleting project', error);
    res.status(500).json({ error: 'Error deleting project', details: error.message });
  }
};

const addLinks = async (req, res) => {
  const { projectId } = req.params;
  const linksData = Array.isArray(req.body) ? req.body : [req.body];
  if (!linksData.every(item => item && typeof item.url === 'string' && item.url.trim() && item.targetDomain)) {
    return res.status(400).json({ error: 'Each item must have a valid url (non-empty string) and targetDomain' });
  }

  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const now = new Date();
    if (now.getMonth() !== user.lastReset.getMonth()) {
      user.linksCheckedThisMonth = 0;
      user.lastReset = now;
    }

    const planLimits = {
      free: 100,
      basic: 10000,
      pro: 50000,
      premium: 200000,
      enterprise: Infinity,
    };
    const newLinksCount = linksData.length;
    if (!user.isSuperAdmin && user.linksCheckedThisMonth + newLinksCount > planLimits[user.plan]) {
      return res.status(403).json({ message: 'Link limit exceeded for your plan' });
    }

    const newLinks = [];
    for (const { url, targetDomain } of linksData) {
      const newLink = new FrontendLink({
        url,
        targetDomains: [targetDomain],
        projectId,
        userId: req.userId,
        source: 'manual',
        status: 'pending'
      });
      await newLink.save();
      newLinks.push(newLink);
    }

    project.links.push(...newLinks.map(link => link._id));
    await project.save();

    user.linksCheckedThisMonth += newLinksCount;
    await user.save();
    res.status(201).json(newLinks);
  } catch (error) {
    console.error('addLinks: Error adding links', error);
    res.status(500).json({ error: 'Error adding links', details: error.message });
  }
};

const getLinks = async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const links = await FrontendLink.find({ projectId, source: 'manual' });
    res.json(links);
  } catch (error) {
    console.error('getLinks: Error fetching links', error);
    res.status(500).json({ error: 'Error fetching links', details: error.message });
  }
};

const deleteLink = async (req, res) => {
  const { projectId, id } = req.params;
  try {
    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const deletedLink = await FrontendLink.findOneAndDelete({ _id: id, projectId });
    if (!deletedLink) return res.status(404).json({ error: 'Link not found' });

    project.links = project.links.filter(linkId => linkId.toString() !== id);
    await project.save();

    res.json({ message: 'Link deleted' });
  } catch (error) {
    console.error('deleteLink: Error deleting link', error);
    res.status(500).json({ error: 'Error deleting link', details: error.message });
  }
};

const deleteAllLinks = async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    await FrontendLink.deleteMany({ projectId });
    project.links = [];
    await project.save();

    res.json({ message: 'All links deleted' });
  } catch (error) {
    console.error('deleteAllLinks: Error deleting all links', error);
    res.status(500).json({ error: 'Error deleting all links', details: error.message });
  }
};

const exportLinksToExcel = async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findOne({ _id: projectId, userId: req.userId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const links = await FrontendLink.find({ projectId, source: 'manual' });
    if (links.length === 0) return res.status(400).json({ error: 'No manual links found to export' });

    // Формируем данные для Excel
    const data = links.map(link => {
      const responseCode = link.responseCode || (link.status === 'timeout' ? 'Timeout' : '200');
      const isLinkFound = link.status === 'active' && link.rel !== 'not found';
      const indexabilityStatus = link.indexabilityStatus || (link.canonicalUrl && link.url !== link.canonicalUrl ? 'canonicalized' : '') || '';
      return {
        URL: link.url,
        Status: (responseCode === '200' || responseCode === '304') && link.isIndexable && isLinkFound ? 'OK' : 'Problem',
        'Response Code': responseCode,
        Indexability: link.isIndexable === null ? 'Unknown' : link.isIndexable ? 'Yes' : 'No',
        'Indexability Status': indexabilityStatus,
        'Link Found': isLinkFound ? `True (${link.lastChecked ? link.lastChecked.toISOString().split('T')[0] : 'N/A'})` : `False (${link.lastChecked ? link.lastChecked.toISOString().split('T')[0] : 'N/A'})`,
        'Last Checked': link.lastChecked ? link.lastChecked.toISOString().split('T')[0] : 'N/A'
      };
    });

    // Создаём Excel-файл
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Manual Links');

    // Настраиваем заголовки столбцов
    worksheet['!cols'] = [
      { wch: 40 }, // URL
      { wch: 10 }, // Status
      { wch: 15 }, // Response Code
      { wch: 15 }, // Indexability
      { wch: 20 }, // Indexability Status
      { wch: 20 }, // Link Found
      { wch: 15 }  // Last Checked
    ];

    // Формируем бинарный буфер
    const buffer = XLSX.writeFile(workbook, 'xlsx', { compression: true });

    // Отправляем файл
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Manual_Links_${projectId}_${new Date().toISOString().split('T')[0]}.xlsx`);
    res.send(buffer);
  } catch (error) {
    console.error(`exportLinksToExcel: Error exporting links for project ${projectId}:`, error);
    res.status(500).json({ error: 'Error exporting links to Excel', details: error.message });
  }
};

module.exports = {
  createProject,
  getProjects,
  deleteProject,
  addLinks,
  getLinks,
  deleteLink,
  deleteAllLinks,
  exportLinksToExcel
};