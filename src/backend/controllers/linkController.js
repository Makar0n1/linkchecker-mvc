const FrontendLink = require('../models/FrontendLink');
const Project = require('../models/Project');
const User = require('../models/User');

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

module.exports = {
  addLinks,
  getLinks,
  deleteLink,
  deleteAllLinks,
};